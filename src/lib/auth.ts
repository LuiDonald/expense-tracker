import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import type { Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "./supabase";

/**
 * The single account allowed to use this app. This is a PRIVATE expense
 * tracker — unlike a public site, NOTHING is readable until you sign in as the
 * owner. The owner email is used here to show/hide UI, but the *real*
 * enforcement lives in Supabase Row Level Security, which rejects every read
 * and write that doesn't come from the owner's authenticated session.
 */
const OWNER_EMAIL = (process.env.EXPO_PUBLIC_OWNER_EMAIL ?? "")
  .toLowerCase()
  .trim();

/**
 * When true, the app is locked behind the passcode gate (see components/Lock).
 * A correct passcode mints a real owner session, so the database is protected
 * by owner-only RLS. Set to `false` only for temporary open testing (also
 * requires relaxing RLS via supabase/schema-open.sql).
 */
export const REQUIRE_LOGIN = true;

// Tiny shared auth store so every screen sees the same session.
let currentSession: Session | null = null;
let initialized = false;
// Whether the initial session lookup has finished (so screens can avoid
// flashing the locked state before their session has loaded).
let ready = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function init() {
  if (initialized || !isSupabaseConfigured || !supabase) {
    // In mock/no-Supabase mode there's nothing to wait for.
    if (!isSupabaseConfigured) ready = true;
    return;
  }
  initialized = true;
  supabase.auth.getSession().then(({ data }) => {
    currentSession = data.session;
    ready = true;
    emit();
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    ready = true;
    emit();
  });
}

export interface AuthState {
  session: Session | null;
  email: string | null;
  isSignedIn: boolean;
  /** Signed in AND the owner (matches the owner email, if one is set). */
  isOwner: boolean;
  /** True once the initial session check has completed. */
  ready: boolean;
}

export function useAuth(): AuthState {
  const [, setTick] = useState(0);

  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    init();
    return () => {
      listeners.delete(l);
    };
  }, []);

  const session = currentSession;
  const email = session?.user?.email?.toLowerCase() ?? null;
  const isSignedIn = !!session;
  // If no owner email is configured, any signed-in user counts as the owner.
  const isOwner = isSignedIn && (!OWNER_EMAIL || email === OWNER_EMAIL);

  return { session, email, isSignedIn, isOwner, ready };
}

/** Where the magic-link email should send the user back to. */
function redirectTo(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  // Native: deep link back into the app via the "expense" scheme.
  return Linking.createURL("/");
}

/** Send a passwordless magic-link sign-in email. */
export async function sendMagicLink(email: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured");
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: redirectTo(),
      // Never create a new account — only the pre-existing owner can sign in.
      // Combined with Supabase's "disable signups" setting, this locks access
      // to the owner only.
      shouldCreateUser: false,
    },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

/** The configured owner email (for display/help text). */
export const ownerEmail = OWNER_EMAIL;
