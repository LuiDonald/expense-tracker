import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useExpense, expenseStore } from "../../src/data/expenseStore";
import { iconForCategory } from "../../src/data/categories";
import { useAuth } from "../../src/lib/auth";
import { confirmDialog, alertDialog } from "../../src/lib/dialogs";
import { formatCurrency, formatDate } from "../../src/lib/format";
import { colors, maxContentWidth, radius, spacing } from "../../src/lib/theme";

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { expense, loading } = useExpense(id);
  const { isOwner } = useAuth();

  if (!expense) {
    return (
      <View style={styles.centered}>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.muted}>Expense not found.</Text>
        )}
      </View>
    );
  }

  const confirmDelete = async () => {
    const ok = await confirmDialog(
      "Delete expense",
      `Delete the ${formatCurrency(expense.amount)} expense at ${
        expense.merchant || "this merchant"
      }? This can't be undone.`,
      { confirmText: "Delete", destructive: true }
    );
    if (!ok) return;
    try {
      await expenseStore.remove(expense.id);
      router.canGoBack() ? router.back() : router.replace("/");
    } catch (e: any) {
      alertDialog("Couldn't delete", e?.message ?? "Unknown error");
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: expense.merchant || "Expense",
          headerLeft: () => (
            <Pressable
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/")
              }
              hitSlop={12}
              style={styles.backBtn}
            >
              <Text style={styles.backText}>‹ Back</Text>
            </Pressable>
          ),
          headerRight: isOwner
            ? () => (
                <Pressable
                  onPress={() => router.push(`/edit/${expense.id}`)}
                  hitSlop={12}
                >
                  <Text style={styles.headerAction}>Edit</Text>
                </Pressable>
              )
            : undefined,
        }}
      />

      {/* Amount hero */}
      <View style={styles.hero}>
        <Text style={styles.categoryPill}>
          {iconForCategory(expense.category)}  {expense.category || "Uncategorized"}
        </Text>
        <Text style={styles.amount}>{formatCurrency(expense.amount)}</Text>
        <Text style={styles.merchant}>{expense.merchant || "Unknown merchant"}</Text>
        <Text style={styles.date}>{formatDate(expense.date)}</Text>
      </View>

      {expense.note ? (
        <View style={styles.section}>
          <Text style={styles.heading}>Note</Text>
          <Text style={styles.body}>{expense.note}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.heading}>Receipt</Text>
        {expense.photoUrl ? (
          <Image source={{ uri: expense.photoUrl }} style={styles.receipt} />
        ) : (
          <Text style={styles.muted}>No receipt photo attached.</Text>
        )}
      </View>

      {isOwner && (
        <Pressable style={styles.deleteBtn} onPress={confirmDelete}>
          <Text style={styles.deleteText}>Delete expense</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingBottom: spacing.xl * 2,
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  backBtn: { paddingHorizontal: spacing.sm },
  backText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  headerAction: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  hero: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  categoryPill: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primary,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  amount: { fontSize: 40, fontWeight: "800", color: colors.text, marginTop: spacing.sm },
  merchant: { fontSize: 18, fontWeight: "600", color: colors.text },
  date: { fontSize: 14, color: colors.textMuted },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  heading: { fontSize: 16, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 22 },
  muted: { color: colors.textMuted },
  receipt: {
    width: "100%",
    height: 360,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    resizeMode: "contain",
  },
  deleteBtn: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteText: { color: colors.danger, fontWeight: "600", fontSize: 15 },
});
