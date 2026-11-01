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
import { useAuth, sendMagicLink, REQUIRE_LOGIN } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  getPasscodeStatus,
  setPasscode,
  unlockWithPasscode,
  PasscodeUser,
} from "../lib/passcode";
import { colors, maxContentWidth, radius, spacing } from "../lib/theme";

/**
 * Wraps the whole app. Until the signed-in user is one of the allowed accounts
 * (and has a passcode), it shows the passcode gate: pick who you are, then
 * enter your passcode. A correct passcode mints that user's session, so each
 * person sees only their own expenses (owner-scoped RLS).
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const { email, isOwner, ready } = useAuth();
  const [users, setUsers] = useState<PasscodeUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUsers(await getPasscodeStatus());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (REQUIRE_LOGIN && isSupabaseConfigured) refresh();
  }, [refresh, isOwner]);

  // Open testing mode, or no backend — no gate.
  if (!REQUIRE_LOGIN || !isSupabaseConfigured) return <>{children}</>;

  if (!ready || (!users && !failed)) return <Splash />;
  if (failed || !users) return <ErrorState onRetry={refresh} />;

  // Signed in as an allowed user: let them in, unless they still need a passcode.
  if (isOwner) {
    const me = users.find((u) => u.email === (email ?? "").toLowerCase());
    if (me && !me.configured) return <CreatePasscode onDone={refresh} />;
    return <>{children}</>;
  }

  // Signed out: pick who you are, then unlock (or first-time email setup).
  if (!selected) return <UserPicker users={users} onPick={setSelected} />;
  const user = users.find((u) => u.email === selected) ?? users[0];
  return user.configured ? (
    <EnterPasscode user={user} onBack={() => setSelected(null)} />
  ) : (
    <FirstTimeEmail user={user} onBack={() => setSelected(null)} />
  );
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

function UserPicker({
  users,
  onPick,
}: {
  users: PasscodeUser[];
  onPick: (email: string) => void;
}) {
  return (
    <Shell>
      <Text style={styles.emoji}>🔒</Text>
      <Text style={styles.title}>Who's this?</Text>
      <Text style={styles.body}>Choose your account to unlock your expenses.</Text>
      {users.map((u) => (
        <Pressable key={u.email} style={styles.userBtn} onPress={() => onPick(u.email)}>
          <Text style={styles.userName}>{u.name}</Text>
          <Text style={styles.userMeta}>
            {u.configured ? "Enter passcode" : "First-time setup"}
          </Text>
        </Pressable>
      ))}
    </Shell>
  );
}

function EnterPasscode({
  user,
  onBack,
}: {
  user: PasscodeUser;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useEmail, setUseEmail] = useState(false);

  if (useEmail) {
    return <FirstTimeEmail user={user} forgot onBack={() => setUseEmail(false)} />;
  }

  const submit = async () => {
    if (!code.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await unlockWithPasscode(user.email, code.trim());
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
      <Text style={styles.title}>Hi {user.name}</Text>
      <Text style={styles.body}>Enter your passcode to unlock.</Text>
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
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.linkMuted}>← Not {user.name}?</Text>
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
  user,
  forgot = false,
  onBack,
}: {
  user: PasscodeUser;
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
      await sendMagicLink(user.email);
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
          We sent a one-time sign-in link to {user.email}. Open it on this
          device, then you can {forgot ? "set a new passcode" : "choose your passcode"}.
        </Text>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={8}>
            <Text style={styles.linkMuted}>← Back</Text>
          </Pressable>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <Text style={styles.emoji}>{forgot ? "🔑" : "👋"}</Text>
      <Text style={styles.title}>
        {forgot ? `Reset ${user.name}'s passcode` : `Set up ${user.name}'s passcode`}
      </Text>
      <Text style={styles.body}>
        {forgot
          ? "Confirm it's you with a one-time email link, then set a new passcode."
          : "First, let's confirm it's you. We'll email a one-time sign-in link — then you choose a passcode for next time."}
      </Text>
      <Text style={styles.ownerEmail}>{user.email}</Text>
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
      {onBack && (
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkMuted}>← Back</Text>
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
  userBtn: {
    marginTop: spacing.md,
    width: "100%",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  userName: { fontSize: 18, fontWeight: "700", color: colors.text },
  userMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
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
  linkMuted: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontWeight: "500",
    fontSize: 14,
  },
});
