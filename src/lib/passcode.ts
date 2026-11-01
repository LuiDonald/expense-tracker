import { supabase, isSupabaseConfigured } from "./supabase";

/**
 * Client for the `passcode` Edge Function — a simple lock for this private app.
 *
 *   - getPasscodeStatus(): has a passcode been set yet?
 *   - setPasscode(code):   create/change it (must be signed in as the owner;
 *                          first-time setup happens right after an email link).
 *   - unlockWithPasscode(code): verify the code; on success the server hands
 *                          back a one-time token that we redeem into a real
 *                          OWNER session, so the data stays protected by RLS.
 */

/** Pull the human-readable error out of a Functions error Response. */
async function messageFrom(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as any)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      /* ignore */
    }
  }
  return (error as any)?.message ?? fallback;
}

/** One allowed account plus whether they've set a passcode yet. */
export interface PasscodeUser {
  email: string;
  name: string;
  configured: boolean;
}

export async function getPasscodeStatus(): Promise<PasscodeUser[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase.functions.invoke(
    "passcode?action=status",
    { method: "GET" },
  );
  if (error) throw new Error(await messageFrom(error, "Could not reach the server"));
  return ((data as any)?.users ?? []) as PasscodeUser[];
}

export async function setPasscode(code: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.functions.invoke("passcode?action=set", {
    method: "POST",
    body: { code },
  });
  if (error) throw new Error(await messageFrom(error, "Could not set the passcode"));
}

/**
 * Verify the passcode and, on success, sign the owner in. Throws with a
 * friendly message on a wrong code / lockout.
 */
export async function unlockWithPasscode(email: string, code: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.functions.invoke("passcode?action=verify", {
    method: "POST",
    body: { email, code },
  });
  if (error) throw new Error(await messageFrom(error, "Incorrect passcode"));

  const tokenHash = (data as any)?.token_hash;
  if (!tokenHash) throw new Error("Verification failed — please try again");

  const { error: otpErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (otpErr) throw new Error(otpErr.message);
}
