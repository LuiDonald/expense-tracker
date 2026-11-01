import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useExpenses, expenseStore } from "../../src/data/expenseStore";
import { iconForCategory } from "../../src/data/categories";
import { isSupabaseConfigured } from "../../src/lib/supabase";
import { useAuth, REQUIRE_LOGIN } from "../../src/lib/auth";
import {
  currentMonthKey,
  formatCurrency,
  formatDate,
  monthLabel,
  shiftMonth,
} from "../../src/lib/format";
import { colors, maxContentWidth, radius, spacing } from "../../src/lib/theme";
import { Expense } from "../../src/types/expense";
import { Locked } from "../../src/components/Locked";

export default function ExpensesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { expenses } = useExpenses();
  const { isOwner, ready } = useAuth();
  const [month, setMonth] = useState(currentMonthKey());

  // Gate: when Supabase is configured, nothing is visible until the owner logs
  // in. (In demo mode we show the sample data freely.)
  const locked = REQUIRE_LOGIN && isSupabaseConfigured && ready && !isOwner;

  const groups = useMemo(
    () => expenseStore.categoryGroups(month),
    [expenses, month]
  );
  const monthTotal = useMemo(
    () => expenseStore.monthTotal(month),
    [expenses, month]
  );
  const monthCount = useMemo(
    () => expenseStore.getByMonth(month).length,
    [expenses, month]
  );

  if (locked) return <Locked />;

  // Wait for the first Supabase fetch so we never flash an empty/stale list.
  if (isSupabaseConfigured && !expenseStore.isLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!isSupabaseConfigured && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Demo mode — sample expenses. Add Supabase keys in .env to save your own.
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.centeredList}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 120 }]}
      >
        {/* Month switcher + total */}
        <View style={styles.header}>
          <View style={styles.monthRow}>
            <Pressable
              style={styles.navBtn}
              onPress={() => setMonth((m) => shiftMonth(m, -1))}
              hitSlop={8}
            >
              <Text style={styles.navText}>‹</Text>
            </Pressable>
            <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
            <Pressable
              style={styles.navBtn}
              onPress={() => setMonth((m) => shiftMonth(m, 1))}
              hitSlop={8}
            >
              <Text style={styles.navText}>›</Text>
            </Pressable>
          </View>
          <Text style={styles.total}>{formatCurrency(monthTotal)}</Text>
          <Text style={styles.totalCaption}>
            {monthCount} expense{monthCount === 1 ? "" : "s"} this month
          </Text>
        </View>

        {groups.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No expenses in {monthLabel(month)}.</Text>
            <Text style={styles.emptySub}>Tap ＋ to add one.</Text>
          </View>
        ) : (
          groups.map((g) => {
            const pct = monthTotal > 0 ? (g.total / monthTotal) * 100 : 0;
            return (
              <View key={g.category} style={styles.group}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>
                    {iconForCategory(g.category)}  {g.category}
                  </Text>
                  <Text style={styles.groupTotal}>{formatCurrency(g.total)}</Text>
                </View>
                <Text style={styles.groupMeta}>
                  {pct.toFixed(0)}% of month · {g.count} item{g.count === 1 ? "" : "s"}
                </Text>
                <View style={styles.groupCard}>
                  {g.expenses.map((e, i) => (
                    <ExpenseRow
                      key={e.id}
                      expense={e}
                      divider={i > 0}
                      onPress={() => router.push(`/expense/${e.id}`)}
                    />
                  ))}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
        onPress={() => router.push("/edit/new")}
      >
        <Text style={styles.fabText}>＋</Text>
      </Pressable>
    </View>
  );
}

function ExpenseRow({
  expense,
  divider,
  onPress,
}: {
  expense: Expense;
  divider: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        divider && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {expense.merchant || "Unknown merchant"}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {formatDate(expense.date)}
          {expense.note ? ` · ${expense.note}` : ""}
        </Text>
      </View>
      <Text style={styles.amount}>{formatCurrency(expense.amount)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  banner: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  bannerText: { color: colors.primary, fontSize: 12 },
  header: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    alignItems: "center",
    gap: spacing.xs,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  navText: { fontSize: 22, color: colors.primary, lineHeight: 24 },
  monthLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    minWidth: 150,
    textAlign: "center",
  },
  total: { fontSize: 34, fontWeight: "800", color: colors.text, marginTop: spacing.sm },
  totalCaption: { fontSize: 13, color: colors.textMuted },
  centeredList: {
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
  },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  group: { marginTop: spacing.lg },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  groupTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  groupTotal: { fontSize: 17, fontWeight: "800", color: colors.text },
  groupMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm },
  groupCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPressed: { opacity: 0.6 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 13, color: colors.textMuted },
  amount: { fontSize: 16, fontWeight: "700", color: colors.text },
  empty: { alignItems: "center", marginTop: spacing.xl, gap: spacing.xs },
  emptyText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  emptySub: { color: colors.textMuted, fontSize: 13 },
  fab: {
    position: "absolute",
    right: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fabText: { color: "#fff", fontSize: 30, lineHeight: 34, fontWeight: "600" },
});
