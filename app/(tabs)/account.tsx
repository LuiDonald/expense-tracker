import { useState } from "react";
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
import { useAuth, signOut } from "../../src/lib/auth";
import { setPasscode } from "../../src/lib/passcode";
import { expenseStore } from "../../src/data/expenseStore";
import { isSupabaseConfigured } from "../../src/lib/supabase";
import { colors, maxContentWidth, radius, spacing } from "../../src/lib/theme";

export default function AccountScreen() {
  const { email } = useAuth();

  // Change-passcode form state.
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveCode = async () => {
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
      setSaved(true);
      setEditing(false);
      setCode("");
      setConfirm("");
    } catch (e: any) {
      setError(e?.message ?? "Could not change your passcode");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>
        {!isSupabaseConfigured ? (
          <>
            <Text style={styles.title}>Demo mode</Text>
            <Text style={styles.muted}>
              This app isn't connected to Supabase yet, so it's running on sample
              data. Add your Supabase keys and owner email to{" "}
              <Text style={styles.mono}>.env</Text> to save your own private
              expenses. See the README for setup.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>You're signed in</Text>
            <Text style={styles.muted}>{email}</Text>
            <Text style={[styles.muted, { marginTop: spacing.sm }]}>
              Your expenses are private — unlocked with your passcode.
            </Text>

            {editing ? (
              <>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={setCode}
                  placeholder="New passcode"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  keyboardType="number-pad"
                  maxLength={32}
                  editable={!busy}
                />
                <TextInput
                  style={styles.input}
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Confirm passcode"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  keyboardType="number-pad"
                  maxLength={32}
                  returnKeyType="go"
                  onSubmitEditing={saveCode}
                  editable={!busy}
                />
                {error && <Text style={styles.error}>{error}</Text>}
                <Pressable
                  style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                  onPress={saveCode}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Save passcode</Text>
                  )}
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => {
                    setEditing(false);
                    setError(null);
                    setCode("");
                    setConfirm("");
                  }}
                >
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
                {saved && <Text style={styles.success}>Passcode updated.</Text>}
                <Pressable
                  style={[styles.secondaryBtn, { marginTop: spacing.xl }]}
                  onPress={() => {
                    setSaved(false);
                    setEditing(true);
                  }}
                >
                  <Text style={styles.secondaryBtnText}>Change passcode</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, { marginTop: spacing.sm }]}
                  onPress={async () => {
                    await signOut();
                    expenseStore.reset();
                  }}
                >
                  <Text style={styles.primaryBtnText}>Log out</Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: {
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  muted: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  input: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 13 },
  success: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  primaryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondaryBtn: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
  },
  secondaryBtnText: { color: colors.primary, fontWeight: "600" },
});
