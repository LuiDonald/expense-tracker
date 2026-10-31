import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, maxContentWidth, radius, spacing } from "../lib/theme";

/**
 * Shown on data screens when Supabase is configured but the owner isn't signed
 * in. This is a private app, so there's nothing to show until you log in.
 */
export function Locked() {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji}>🔒</Text>
      <Text style={styles.title}>Your expenses are private</Text>
      <Text style={styles.body}>
        Sign in with the owner account to view and add expenses. Nobody else can
        see your data.
      </Text>
      <Pressable style={styles.btn} onPress={() => router.push("/account")}>
        <Text style={styles.btnText}>Log in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
  },
  emoji: { fontSize: 44 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  btn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
