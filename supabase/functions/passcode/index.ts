// Supabase Edge Function: passcode  (multi-user)
//
// A simple passcode lock for this private expense app. Each allowed user has
// their own passcode and their own private expenses.
//
//   - GET  ?action=status            -> { users: [{ email, name, configured }] }
//   - POST  action=set   {code}      -> set/change the SIGNED-IN user's passcode
//   - POST  action=verify {email,code} -> check a user's passcode; on success
//                                        mint a real session for THAT user.
//
// Passcode hashes live in `user_passcode` (one row per email), which has RLS on
// and no policies, so only this function (service role) ever reads them.
//
// Deploy with JWT verification OFF (status/verify run while logged out):
//   supabase functions deploy passcode --no-verify-jwt --project-ref <ref>
//
// Secrets:
//   OWNER_USERS = "donaldtlui@gmail.com:Donald,grantiana.ko@gmail.com:Grantiana"
//   (auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ITERATIONS = 200_000;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

interface AppUser {
  email: string;
  name: string;
}

/** Parse OWNER_USERS "email:Name,email2:Name2" into a list. */
function allowedUsers(): AppUser[] {
  const raw = Deno.env.get("OWNER_USERS") ?? Deno.env.get("OWNER_EMAIL") ?? "";
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [email, name] = part.split(":");
      const e = (email ?? "").toLowerCase().trim();
      return { email: e, name: (name ?? e.split("@")[0]).trim() };
    })
    .filter((u) => u.email);
}

function findUser(email: string): AppUser | undefined {
  const e = email.toLowerCase().trim();
  return allowedUsers().find((u) => u.email === e);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function pbkdf2(code: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, 256,
  );
  return toHex(new Uint8Array(bits));
}
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

async function readLock(email: string): Promise<LockRow | null> {
  const { data } = await db
    .from("user_passcode")
    .select("passcode_hash, salt, iterations, failed_attempts, locked_until")
    .eq("email", email)
    .maybeSingle();
  return (data as LockRow) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!SERVICE_KEY || !SUPABASE_URL) {
    return json({ error: "Server not configured (service role missing)" }, 500);
  }
  const users = allowedUsers();
  if (users.length === 0) {
    return json({ error: "Server not configured (OWNER_USERS not set)" }, 500);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";

  try {
    // --- status: which users exist and who has a passcode set (public) ---
    if (req.method === "GET" || action === "status") {
      const { data } = await db
        .from("user_passcode")
        .select("email, passcode_hash");
      const configured = new Map<string, boolean>(
        (data ?? []).map((r: any) => [r.email, !!r.passcode_hash]),
      );
      return json({
        users: users.map((u) => ({
          email: u.email,
          name: u.name,
          configured: configured.get(u.email) ?? false,
        })),
      });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* no body */
    }
    const code = typeof body?.code === "string" ? body.code.trim() : "";

    // --- set: create/change the signed-in user's passcode ---
    if (action === "set") {
      const authz = req.headers.get("Authorization") ?? "";
      const jwt = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
      if (!jwt) return json({ error: "Not signed in" }, 401);

      const { data: { user }, error: userErr } = await db.auth.getUser(jwt);
      if (userErr || !user) return json({ error: "Not signed in" }, 401);
      const email = (user.email ?? "").toLowerCase();
      if (!findUser(email)) return json({ error: "Not an allowed user" }, 403);
      if (code.length < 4 || code.length > 32) {
        return json({ error: "Passcode must be 4–32 characters" }, 400);
      }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await pbkdf2(code, salt, ITERATIONS);
      const { error: upErr } = await db.from("user_passcode").upsert({
        email,
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

    // --- verify: check a user's passcode, mint their session (public) ---
    if (action === "verify") {
      const email = (typeof body?.email === "string" ? body.email : "").toLowerCase().trim();
      const who = findUser(email);
      if (!who) return json({ error: "Unknown user" }, 400);

      const lock = await readLock(email);
      if (!lock?.passcode_hash || !lock.salt) {
        return json({ error: "No passcode set for this user" }, 400);
      }
      if (lock.locked_until && new Date(lock.locked_until) > new Date()) {
        return json(
          { error: "Too many attempts — try again later.", locked_until: lock.locked_until },
          429,
        );
      }
      if (!code) return json({ error: "Enter your passcode" }, 400);

      const candidate = await pbkdf2(code, fromHex(lock.salt), lock.iterations ?? ITERATIONS);
      if (!timingSafeEqual(candidate, lock.passcode_hash)) {
        const attempts = (lock.failed_attempts ?? 0) + 1;
        const patch: Record<string, unknown> = { failed_attempts: attempts };
        if (attempts >= MAX_ATTEMPTS) {
          patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
          patch.failed_attempts = 0;
        }
        await db.from("user_passcode").update(patch).eq("email", email);
        return json({ error: "Incorrect passcode" }, 401);
      }

      await db.from("user_passcode").update({ failed_attempts: 0, locked_until: null }).eq("email", email);
      const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) return json({ error: "Could not start session" }, 500);
      return json({ ok: true, email, token_hash: tokenHash });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error" }, 500);
  }
});
