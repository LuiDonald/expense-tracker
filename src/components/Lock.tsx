import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth, sendMagicLink, ownerEmail, REQUIRE_LOGIN } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  getPasscodeStatus,
  setPasscode,
  unlockWithPasscode,
} from "../lib/passcode";
import { colors, maxContentWidth, radius, spacing } from "../lib/theme";

/**
 * Wraps the whole app. While the owner isn't signed in (or hasn't set a
 * passcode yet) it shows the passcode gate instead of the app. A correct
 * passcode mints a real owner session, so the data stays protected by RLS.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const { isOwner, ready } = useAuth();
  const [status, setStatus] = useState<"loading" | "set" | "unset" | "error">(
    "loading",
  );

  const refresh = useCallback(async () => {
    try {
      const configured = await getPasscodeStatus();
      setStatus(configured ? "set" : "unset");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (REQUIRE_LOGIN && isSupabaseConfigured) refresh();
  }, [refresh, isOwner]);

  // Open testing mode, or no backend — no gate.
  if (!REQUIRE_LOGIN || !isSupabaseConfigured) return <>{children}</>;

  if (!ready || status === "loading") return <Splash />;
  if (status === "error") return <ErrorState onRetry={refresh} />;

  if (isOwner) {
    // Signed in: either we're done, or this is first-time setup.
    return status === "set" ? <>{children}</> : <CreatePasscode onDone={refresh} />;
  }

  // Signed out: enter the passcode, or start first-time email setup.
  return status === "set" ? <EnterPasscode /> : <FirstTimeEmail />;
}

// ---------------------------------------------------------------------------

function Splash() {
  return (
    <View style={[styles.wrap, { justifyContent: "center" }]}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji}>⚠️</Text>
      <Text style={styles.title}>Couldn't reach the server</Text>
      <Text style={styles.body}>Check your connection and try again.</Text>
      <Pressable style={styles.primaryBtn} onPress={onRetry}>
        <Text style={styles.primaryBtnText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function EnterPasscode() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useEmail, setUseEmail] = useState(false);

  if (useEmail) return <FirstTimeEmail forgot onBack={() => setUseEmail(false)} />;

  const submit = async () => {
    if (!code.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await unlockWithPasscode(code.trim());
      // Session is set — the gate re-renders and shows the app.
    } catch (e: any) {
      setError(e?.message ?? "Incorrect passcode");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Text style={styles.emoji}>🔒</Text>
      <Text style={styles.title}>Enter your passcode</Text>
      <Text style={styles.body}>Unlock your expenses.</Text>
      <TextInput
        style={styles.code}
        value={code}
        onChangeText={(t) => {
          setCode(t);
          if (error) setError(null);
        }}
        placeholder="••••"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        keyboardType="number-pad"
        autoFocus
        maxLength={32}
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!busy}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.primaryBtn, busy && styles.btnDisabled]}
        onPress={submit}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Unlock</Text>
        )}
      </Pressable>
      <Pressable onPress={() => setUseEmail(true)} hitSlop={8}>
        <Text style={styles.link}>Forgot? Use email instead</Text>
      </Pressable>
    </Shell>
  );
}

function CreatePasscode({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const c = code.trim();
    if (c.length < 4) {
      setError("Use at least 4 digits.");
      return;
    }
    if (c !== confirm.trim()) {
      setError("The passcodes don't match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await setPasscode(c);
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "Could not save your passcode");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Text style={styles.emoji}>🔑</Text>
      <Text style={styles.title}>Create a passcode</Text>
      <Text style={styles.body}>
        You'll use this to unlock the app from now on. 4–32 digits.
      </Text>
      <TextInput
        style={styles.code}
        value={code}
        onChangeText={setCode}
        placeholder="New passcode"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        keyboardType="number-pad"
        autoFocus
        maxLength={32}
        editable={!busy}
      />
      <TextInput
        style={styles.code}
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Confirm passcode"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={32}
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!busy}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.primaryBtn, busy && styles.btnDisabled]}
        onPress={submit}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Save passcode</Text>
        )}
      </Pressable>
    </Shell>
  );
}

function FirstTimeEmail({
  forgot = false,
  onBack,
}: {
  forgot?: boolean;
  onBack?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      await sendMagicLink(ownerEmail);
      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? "Could not send the link");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Shell>
        <Text style={styles.emoji}>📧</Text>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          We sent a one-time sign-in link to {ownerEmail}. Open it on this
          device, then you can {forgot ? "set a new passcode" : "choose your passcode"}.
        </Text>
      </Shell>
    );
  }

  return (
    <Shell>
      <Text style={styles.emoji}>{forgot ? "🔑" : "👋"}</Text>
      <Text style={styles.title}>
        {forgot ? "Reset with email" : "Set up your passcode"}
      </Text>
      <Text style={styles.body}>
        {forgot
          ? "Confirm it's you with a one-time email link, then set a new passcode."
          : "First, let's confirm it's you. We'll email a one-time sign-in link to the owner address — then you choose a passcode for next time."}
      </Text>
      <Text style={styles.ownerEmail}>{ownerEmail}</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.primaryBtn, busy && styles.btnDisabled]}
        onPress={send}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Email me a link</Text>
        )}
      </Pressable>
      {forgot && onBack && (
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.link}>Back to passcode</Text>
        </Pressable>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.wrap}>{children}</View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
    backgroundColor: colors.bg,
  },
  emoji: { fontSize: 44 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, textAlign: "center" },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  ownerEmail: {
    color: colors.text,
    fontWeight: "600",
    fontSize: 15,
    marginTop: spacing.xs,
  },
  code: {
    marginTop: spacing.md,
    width: "100%",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 20,
    letterSpacing: 4,
    textAlign: "center",
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  primaryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    alignSelf: "stretch",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
  link: {
    marginTop: spacing.md,
    color: colors.primary,
    fontWeight: "600",
    fontSize: 14,
  },
});
