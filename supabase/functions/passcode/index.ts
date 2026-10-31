// Supabase Edge Function: passcode
//
// A simple passcode lock for this private expense app.
//   - GET  ?action=status  -> { configured }      is a passcode set yet? (public)
//   - POST  action=set      -> { ok }              set/change the passcode.
//                                                  Requires the OWNER's JWT
//                                                  (first-time setup happens
//                                                  after an email magic-link).
//   - POST  action=verify   -> { ok, token_hash }  check a passcode. On success
//                                                  it mints a real OWNER login
//                                                  (via an admin magic-link
//                                                  token the client redeems),
//                                                  so the data stays protected
//                                                  by owner-only RLS.
//
// The passcode hash lives in the `app_lock` table, which has RLS on and no
// policies, so ONLY this function (service role) can read/write it — the hash
// is never exposed to the browser.
//
// Deploy with JWT verification OFF (status/verify are called while logged out):
//   supabase functions deploy passcode --no-verify-jwt --project-ref <ref>
//
// Auto-injected secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// You must set:          OWNER_EMAIL  (already set for this project)

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OWNER_EMAIL = (Deno.env.get("OWNER_EMAIL") ?? "").toLowerCase().trim();

const LOCK_ID = "expense";
const ITERATIONS = 200_000;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function pbkdf2(
  code: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return toHex(new Uint8Array(bits));
}

/** Constant-time compare of two equal-purpose hex strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

interface LockRow {
  passcode_hash: string | null;
  salt: string | null;
  iterations: number | null;
  failed_attempts: number | null;
  locked_until: string | null;
}

async function readLock(): Promise<LockRow | null> {
  const { data } = await db
    .from("app_lock")
    .select("passcode_hash, salt, iterations, failed_attempts, locked_until")
    .eq("id", LOCK_ID)
    .maybeSingle();
  return (data as LockRow) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!SERVICE_KEY || !SUPABASE_URL) {
    return json({ error: "Server not configured (service role missing)" }, 500);
  }
  if (!OWNER_EMAIL) {
    return json({ error: "Server not configured (OWNER_EMAIL not set)" }, 500);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";

  try {
    // --- status: is a passcode configured yet? (public) ---
    if (req.method === "GET" || action === "status") {
      const lock = await readLock();
      return json({ configured: !!lock?.passcode_hash });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* no body */
    }
    const code = typeof body?.code === "string" ? body.code.trim() : "";

    // --- set: create/change the passcode (OWNER only) ---
    if (action === "set") {
      const authz = req.headers.get("Authorization") ?? "";
      const jwt = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
      if (!jwt) return json({ error: "Not signed in" }, 401);

      const { data: { user }, error: userErr } = await db.auth.getUser(jwt);
      if (userErr || !user) return json({ error: "Not signed in" }, 401);
      if ((user.email ?? "").toLowerCase() !== OWNER_EMAIL) {
        return json({ error: "Not authorized" }, 403);
      }
      if (code.length < 4 || code.length > 32) {
        return json({ error: "Passcode must be 4–32 characters" }, 400);
      }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await pbkdf2(code, salt, ITERATIONS);
      const { error: upErr } = await db.from("app_lock").upsert({
        id: LOCK_ID,
        passcode_hash: hash,
        salt: toHex(salt),
        iterations: ITERATIONS,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      });
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true });
    }

    // --- verify: check passcode, mint an owner session on success (public) ---
    if (action === "verify") {
      const lock = await readLock();
      if (!lock?.passcode_hash || !lock.salt) {
        return json({ error: "No passcode set" }, 400);
      }
      if (lock.locked_until && new Date(lock.locked_until) > new Date()) {
        return json(
          { error: "Too many attempts — try again later.", locked_until: lock.locked_until },
          429,
        );
      }
      if (!code) return json({ error: "Enter your passcode" }, 400);

      const candidate = await pbkdf2(
        code,
        fromHex(lock.salt),
        lock.iterations ?? ITERATIONS,
      );
      if (!timingSafeEqual(candidate, lock.passcode_hash)) {
        const attempts = (lock.failed_attempts ?? 0) + 1;
        const patch: Record<string, unknown> = { failed_attempts: attempts };
        if (attempts >= MAX_ATTEMPTS) {
          patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
          patch.failed_attempts = 0;
        }
        await db.from("app_lock").update(patch).eq("id", LOCK_ID);
        return json({ error: "Incorrect passcode" }, 401);
      }

      // Correct — reset counters and mint a real owner login.
      await db.from("app_lock").update({ failed_attempts: 0, locked_until: null }).eq("id", LOCK_ID);
      const { data, error } = await db.auth.admin.generateLink({
        type: "magiclink",
        email: OWNER_EMAIL,
      });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) {
        return json({ error: "Could not start session" }, 500);
      }
      return json({ ok: true, email: OWNER_EMAIL, token_hash: tokenHash });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error" }, 500);
  }
});
