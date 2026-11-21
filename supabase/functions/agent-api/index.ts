// Supabase Edge Function: agent-api
//
// A small, bearer-token-protected HTTP API that lets an AI assistant (e.g.
// "Muse") log and review your expenses. You send it a photo of a receipt in
// your chat; the assistant reads the merchant / amount / date / category from
// the image itself, then calls POST /expenses here to save it.
//
// It talks to the `expenses` table using the service_role key, so it works
// without a user login — the bearer token IS the auth. Keep that token secret.
//
// IMPORTANT — deploy with JWT verification OFF, because we authenticate with our
// own bearer tokens rather than a Supabase user JWT:
//   supabase functions deploy agent-api --no-verify-jwt --project-ref <ref>
//
// Multi-user: each person gets their OWN token, and the token decides whose
// expenses are read and written. One person's token can never see or change
// the other's expenses.
//
// Secrets (Dashboard > Edge Functions > Secrets, or `supabase secrets set`):
//   AGENT_TOKENS = "<token1>:<email-or-user-id>,<token2>:<email-or-user-id>"
//     e.g. "3f9a…:donaldtlui@gmail.com,b71c…:grantiana.ko@gmail.com"
//   Legacy single-user form (still honored, merged with AGENT_TOKENS):
//     EXPENSE_AGENT_TOKEN (or AGENT_API_TOKEN) + AGENT_USER_ID
// Auto-injected by Supabase (do NOT set these yourself):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Routes (all under /functions/v1/agent-api):
//   GET    /expenses?month=&category=&from=&to=&q=&limit=&offset=   list / filter
//   GET    /expenses/summary?month=YYYY-MM                          month total + category breakdown
//   GET    /expenses/:id                                            one expense
//   POST   /expenses                                                create (log) an expense
//   PATCH  /expenses/:id                                            update fields
//   DELETE /expenses/:id                                            delete an expense

import { createClient } from "jsr:@supabase/supabase-js@2";
import { canonicalCategory } from "../_shared/categories.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** token -> owner ("email" or auth user id), from AGENT_TOKENS + legacy secrets. */
function loadTokenOwners(): Map<string, string> {
  const owners = new Map<string, string>();
  for (const pair of (Deno.env.get("AGENT_TOKENS") ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i <= 0) continue;
    const token = pair.slice(0, i).trim();
    const owner = pair.slice(i + 1).trim().toLowerCase();
    if (token && owner) owners.set(token, owner);
  }
  // Legacy: one token for one user (kept so an existing Muse setup keeps working).
  const legacyToken = (
    Deno.env.get("EXPENSE_AGENT_TOKEN") ?? Deno.env.get("AGENT_API_TOKEN") ?? ""
  ).trim();
  const legacyUser = (Deno.env.get("AGENT_USER_ID") ?? "").trim().toLowerCase();
  if (legacyToken && legacyUser && !owners.has(legacyToken)) {
    owners.set(legacyToken, legacyUser);
  }
  return owners;
}
const TOKEN_OWNERS = loadTokenOwners();

/** Constant-time string compare, so response timing doesn't leak the token. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

/** The owner string for a bearer token, or null if it isn't one of ours. */
function ownerForToken(token: string): string | null {
  let found: string | null = null;
  for (const [t, owner] of TOKEN_OWNERS) {
    if (safeEqual(t, token)) found = owner; // no early exit: keep timing flat
  }
  return found;
}


const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// Half-open date range [start, endExclusive) for a "YYYY-MM" month. Avoids the
// invalid "YYYY-MM-31" bug on 28/29/30-day months by using the first of the
// NEXT month as an exclusive upper bound.
function monthRange(month: string): { start: string; endExclusive: string } {
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: `${month}-01`,
    endExclusive: `${nextY}-${String(nextM).padStart(2, "0")}-01`,
  };
}

class BadRequest extends Error {}

// Owner emails are resolved to auth user ids once, then cached.
const userIdCache = new Map<string, string>();
async function resolveUserId(owner: string): Promise<string | null> {
  if (UUID_RE.test(owner)) return owner;
  const cached = userIdCache.get(owner);
  if (cached) return cached;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === owner);
    if (match) {
      userIdCache.set(owner, match.id);
      return match.id;
    }
    if (data.users.length < 100) break;
  }
  return null;
}

// ---- shaping DB rows into clean API JSON ----
function expensePublic(r: Record<string, any>) {
  const amount =
    typeof r.amount === "number" ? r.amount : parseFloat(String(r.amount ?? "")) || 0;
  return {
    id: r.id,
    merchant: r.merchant ?? "",
    amount,
    category: r.category ?? "",
    date: (r.date ?? "").slice(0, 10),
    note: r.note ?? "",
    photoUrl: r.photo_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---- validation helpers ----
function optString(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new BadRequest(`"${field}" must be a string`);
  return v;
}

function optAmount(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) throw new BadRequest(`"${field}" must be a number`);
  return Math.round(n * 100) / 100;
}

function normalizeCategory(raw?: string): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (!t) return "";
  return canonicalCategory(t) ?? t; // known -> canonical spelling; custom passes through
}

async function readJson(req: Request): Promise<Record<string, any>> {
  try {
    const b = await req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b;
    throw new Error();
  } catch {
    throw new BadRequest("Body must be a JSON object");
  }
}

// ---- handlers ----
async function listExpenses(userId: string, url: URL): Promise<Response> {
  const month = (url.searchParams.get("month") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200
  );
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  let query = db
    .from("expenses")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (month) {
    if (!MONTH_RE.test(month)) throw new BadRequest('"month" must be "YYYY-MM"');
    const { start, endExclusive } = monthRange(month);
    query = query.gte("date", start).lt("date", endExclusive);
  }
  if (from) {
    if (!DATE_RE.test(from)) throw new BadRequest('"from" must be "YYYY-MM-DD"');
    query = query.gte("date", from);
  }
  if (to) {
    if (!DATE_RE.test(to)) throw new BadRequest('"to" must be "YYYY-MM-DD"');
    query = query.lte("date", to);
  }
  if (category) query = query.ilike("category", category);
  if (q) {
    const safe = q.replace(/[,()*:]/g, " ").trim();
    if (safe) query = query.or(`merchant.ilike.*${safe}*,note.ilike.*${safe}*`);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;

  const rows = (data ?? []).map(expensePublic);
  const total = rows.reduce((s, e) => s + e.amount, 0);
  return json({
    data: rows,
    pagination: { limit, offset, total: count ?? null },
    sum: Math.round(total * 100) / 100,
  });
}

async function monthSummary(userId: string, url: URL): Promise<Response> {
  const month = (url.searchParams.get("month") ?? "").trim();
  if (!MONTH_RE.test(month)) throw new BadRequest('"month" query param (YYYY-MM) is required');

  const { start, endExclusive } = monthRange(month);
  const { data, error } = await db
    .from("expenses")
    .select("*")
    .eq("user_id", userId)
    .gte("date", start)
    .lt("date", endExclusive);
  if (error) throw error;

  const rows = (data ?? []).map(expensePublic);
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const byCat = new Map<string, { category: string; total: number; count: number }>();
  for (const e of rows) {
    const cat = e.category || "Uncategorized";
    if (!byCat.has(cat)) byCat.set(cat, { category: cat, total: 0, count: 0 });
    const c = byCat.get(cat)!;
    c.total = Math.round((c.total + e.amount) * 100) / 100;
    c.count += 1;
  }
  return json({
    month,
    total: Math.round(total * 100) / 100,
    count: rows.length,
    categories: Array.from(byCat.values()).sort((a, b) => b.total - a.total),
  });
}

async function getExpense(userId: string, id: string): Promise<Response> {
  if (!UUID_RE.test(id)) throw new BadRequest("Invalid expense id");
  const { data, error } = await db
    .from("expenses")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return json({ error: "Expense not found" }, 404);
  return json(expensePublic(data));
}

async function createExpense(userId: string, req: Request): Promise<Response> {
  const body = await readJson(req);

  const merchant = optString(body.merchant, "merchant") ?? "";
  const amount = optAmount(body.amount, "amount");
  if (amount === undefined || amount <= 0) {
    throw new BadRequest('"amount" is required and must be greater than 0');
  }
  const date = optString(body.date, "date");
  if (date !== undefined && date && !DATE_RE.test(date)) {
    throw new BadRequest('"date" must be "YYYY-MM-DD"');
  }

  const row = {
    user_id: userId,
    merchant: merchant.trim(),
    amount,
    category: normalizeCategory(optString(body.category, "category")) ?? "",
    date: date && DATE_RE.test(date) ? date : new Date().toISOString().slice(0, 10),
    note: (optString(body.note, "note") ?? "").trim(),
    photo_url: optString(body.photoUrl ?? body.photo_url, "photoUrl") ?? null,
  };

  const { data, error } = await db.from("expenses").insert(row).select("*").single();
  if (error) throw error;
  return json(expensePublic(data), 201);
}

async function patchExpense(userId: string, id: string, req: Request): Promise<Response> {
  if (!UUID_RE.test(id)) throw new BadRequest("Invalid expense id");
  const body = await readJson(req);

  const update: Record<string, any> = {};
  const merchant = optString(body.merchant, "merchant");
  if (merchant !== undefined) update.merchant = merchant.trim();
  const amount = optAmount(body.amount, "amount");
  if (amount !== undefined) {
    if (amount <= 0) throw new BadRequest('"amount" must be greater than 0');
    update.amount = amount;
  }
  const category = normalizeCategory(optString(body.category, "category"));
  if (category !== undefined) update.category = category;
  const date = optString(body.date, "date");
  if (date !== undefined) {
    if (!DATE_RE.test(date)) throw new BadRequest('"date" must be "YYYY-MM-DD"');
    update.date = date;
  }
  const note = optString(body.note, "note");
  if (note !== undefined) update.note = note.trim();
  const photo = optString(body.photoUrl ?? body.photo_url, "photoUrl");
  if (photo !== undefined) update.photo_url = photo;

  if (Object.keys(update).length === 0) {
    throw new BadRequest(
      "No updatable fields provided (merchant, amount, category, date, note, photoUrl)"
    );
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from("expenses")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return json({ error: "Expense not found" }, 404);
  return json(expensePublic(data));
}

async function deleteExpense(userId: string, id: string): Promise<Response> {
  if (!UUID_RE.test(id)) throw new BadRequest("Invalid expense id");
  const { data, error } = await db
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) return json({ error: "Expense not found" }, 404);
  return json({ id, deleted: true });
}

// ---- router ----
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!SERVICE_KEY || !SUPABASE_URL) {
    return json({ error: "Server not configured (service role key missing)" }, 500);
  }
  if (TOKEN_OWNERS.size === 0) {
    return json({ error: "Server not configured (AGENT_TOKENS not set)" }, 500);
  }

  // Bearer auth: the token decides whose expenses this request can touch.
  const authz = req.headers.get("Authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const owner = token ? ownerForToken(token) : null;
  if (!owner) {
    return json({ error: "Unauthorized" }, 401);
  }
  let userId: string | null;
  try {
    userId = await resolveUserId(owner);
  } catch (e) {
    console.error("agent-api: user lookup failed:", e);
    return json({ error: "Could not look up the token's user" }, 500);
  }
  if (!userId) {
    console.error(`agent-api: no auth user for token owner "${owner}"`);
    return json({ error: "Server not configured (token's user not found)" }, 500);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/agent-api/, "");
  const seg = path.split("/").filter(Boolean); // ["expenses", id?|"summary"?]

  try {
    if (seg[0] !== "expenses") {
      return json({ error: "Not found" }, 404);
    }

    // /expenses
    if (seg.length === 1) {
      if (req.method === "GET") return await listExpenses(userId, url);
      if (req.method === "POST") return await createExpense(userId, req);
      return json({ error: "Method not allowed" }, 405);
    }

    // /expenses/summary  or  /expenses/:id
    if (seg.length === 2) {
      if (seg[1] === "summary") {
        if (req.method === "GET") return await monthSummary(userId, url);
        return json({ error: "Method not allowed" }, 405);
      }
      const id = seg[1];
      if (req.method === "GET") return await getExpense(userId, id);
      if (req.method === "PATCH") return await patchExpense(userId, id, req);
      if (req.method === "DELETE") return await deleteExpense(userId, id);
      return json({ error: "Method not allowed" }, 405);
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof BadRequest) return json({ error: e.message }, 400);
    console.error("agent-api error:", e);
    const message = e instanceof Error ? e.message : "Internal error";
    return json({ error: message }, 500);
  }
});
