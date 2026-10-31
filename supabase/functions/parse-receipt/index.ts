// Supabase Edge Function: parse-receipt
//
// Reads a PHOTO of a receipt (or a gas-station sales screen) and extracts the
// structured expense fields — merchant, total amount, date, a best-fit
// category, and a short note — using OpenAI's vision model (gpt-4o).
//
// The OpenAI key stays server-side; only the signed-in OWNER may call this, so
// random visitors can't burn your OpenAI credits.
//
// Secrets (Dashboard > Edge Functions > Secrets, or `supabase secrets set`):
//   OPENAI_API_KEY = sk-...
//   OWNER_EMAIL    = donaldtlui@gmail.com   (optional but recommended)
//   OPENAI_MODEL   = gpt-4o-mini            (optional; must be vision-capable.
//                                            Defaults to gpt-4o-mini — cheap and
//                                            fine for receipts. Use gpt-4o for
//                                            messy/faded ones.)
// Auto-injected by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY
//
// Deploy:
//   supabase functions deploy parse-receipt --project-ref <ref>

import { createClient } from "jsr:@supabase/supabase-js@2";

// Keep this list in sync with src/data/categories.ts.
const CATEGORIES = [
  "Groceries",
  "Car",
  "Gas",
  "Shopping",
  "Dining",
  "Utilities",
  "Health",
  "Home",
  "Entertainment",
  "Travel",
  "Other",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You read a photo of a purchase receipt or a gas-station fuel-sale screen and extract the expense as structured data.

Return ONLY a JSON object with EXACTLY these keys:
{
  "merchant": string,   // store/brand name, e.g. "Costco", "Shell", "Amazon". "" if unreadable.
  "amount": number,     // the GRAND TOTAL actually paid, as a plain number (no currency symbol). Use the final total incl. tax/tip, not a subtotal. 0 if unreadable.
  "date": string,       // the purchase date as "YYYY-MM-DD". "" if not shown.
  "category": string,   // the single best fit from the list below, or "" if unclear.
  "note": string        // a VERY short note if useful (e.g. "gallons: 12.3", "oil change"), else "".
}

Rules:
- "amount" is a number like 42.19 (no "$", no commas). Pick the final total paid.
- For a gas receipt, "merchant" is the station brand (Shell, Chevron, etc.), category is "Gas", and you may put gallons/price-per-gallon in "note".
- "category" MUST be one of: ${CATEGORIES.join(", ")}.
- If the image clearly isn't a receipt/sale, return the shape with empty/zero values.
- Output JSON only — no commentary.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // --- Auth: require the signed-in owner ---
  // TEMPORARY: set the REQUIRE_OWNER secret to "false" to open scanning up for
  // testing (no login needed). Set it back to "true" (or unset it) to re-lock.
  const requireOwner =
    (Deno.env.get("REQUIRE_OWNER") ?? "true").toLowerCase().trim() !== "false";

  if (requireOwner) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const ownerEmail = (Deno.env.get("OWNER_EMAIL") ?? "").toLowerCase().trim();
    const authHeader = req.headers.get("Authorization") ?? "";

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return json({ error: "Not signed in" }, 401);
    const email = (user.email ?? "").toLowerCase();
    if (ownerEmail && email !== ownerEmail) {
      return json({ error: "Not authorized" }, 403);
    }
  }

  // --- Input ---
  let image: unknown;
  try {
    const body = await req.json();
    image = body?.image;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof image !== "string" || !image.trim()) {
    return json({ error: "Provide an image (data: or http(s) URL)" }, 400);
  }
  if (!/^data:image\/|^https?:\/\//i.test(image)) {
    return json({ error: "Image must be a data: URL or an http(s) URL" }, 400);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);
  // Dedicated model for receipts (isolated from Recipe's shared OPENAI_MODEL).
  // Falls back to the shared OPENAI_MODEL, then cheap gpt-4o-mini.
  const model =
    Deno.env.get("RECEIPT_MODEL") ?? Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
  // Reasoning models (o-series, GPT-5 family) reject a custom temperature.
  const isReasoningModel = /^(o\d|gpt-5)/i.test(model);

  const userContent: Record<string, unknown>[] = [
    { type: "text", text: "Extract the expense from this receipt image." },
    { type: "image_url", image_url: { url: image, detail: "high" } },
  ];

  // --- OpenAI ---
  let aiRes: Response;
  try {
    aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        ...(isReasoningModel ? {} : { temperature: 0 }),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (e) {
    return json({ error: `OpenAI request failed: ${e}` }, 502);
  }

  if (!aiRes.ok) {
    const detail = await aiRes.text();
    console.error(`OpenAI error ${aiRes.status} (model=${model}):`, detail);
    return json({ error: `OpenAI error ${aiRes.status}`, detail }, 502);
  }

  const payload = await aiRes.json();
  const content = payload?.choices?.[0]?.message?.content ?? "{}";

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    return json({ error: "Model did not return valid JSON" }, 502);
  }

  // --- Normalize / harden the shape ---
  const asStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const rawAmount = parsed.amount;
  const amount =
    typeof rawAmount === "number"
      ? rawAmount
      : parseFloat(String(rawAmount ?? "").replace(/[^0-9.]/g, "")) || 0;

  const rawCategory = asStr(parsed.category);
  const category =
    CATEGORIES.find((c) => c.toLowerCase() === rawCategory.toLowerCase()) ?? "";

  const rawDate = asStr(parsed.date);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : "";

  return json({
    expense: {
      merchant: asStr(parsed.merchant),
      amount: Math.max(0, Math.round(amount * 100) / 100),
      category,
      date,
      note: asStr(parsed.note),
    },
  });
});
