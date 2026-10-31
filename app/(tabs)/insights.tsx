import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useExpenses, expenseStore } from "../../src/data/expenseStore";
import { iconForCategory } from "../../src/data/categories";
import { isSupabaseConfigured } from "../../src/lib/supabase";
import { useAuth, REQUIRE_LOGIN } from "../../src/lib/auth";
import {
  currentMonthKey,
  formatCurrency,
  monthLabel,
  shiftMonth,
} from "../../src/lib/format";
import { colors, maxContentWidth, radius, spacing } from "../../src/lib/theme";
import { Locked } from "../../src/components/Locked";

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const { expenses } = useExpenses();
  const { isOwner, ready } = useAuth();
  const [month, setMonth] = useState(currentMonthKey());

  const locked = REQUIRE_LOGIN && isSupabaseConfigured && ready && !isOwner;

  const catTotals = useMemo(
    () => expenseStore.categoryTotals(month),
    [expenses, month]
  );
  const monthTotal = useMemo(
    () => expenseStore.monthTotal(month),
    [expenses, month]
  );
  const allMonths = useMemo(() => expenseStore.groupedByMonth(), [expenses]);
  const maxCat = catTotals.length ? catTotals[0].total : 0;

  if (locked) return <Locked />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      {!isSupabaseConfigured && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Demo mode — sample expenses.</Text>
        </View>
      )}

      {/* Month switcher */}
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
      <Text style={styles.totalCaption}>Total spent in {monthLabel(month)}</Text>

      {/* Category breakdown */}
      <Text style={styles.sectionTitle}>By category</Text>
      {catTotals.length === 0 ? (
        <Text style={styles.muted}>No spending recorded this month.</Text>
      ) : (
        <View style={styles.card}>
          {catTotals.map((c) => {
            const pct = monthTotal > 0 ? (c.total / monthTotal) * 100 : 0;
            const barPct = maxCat > 0 ? (c.total / maxCat) * 100 : 0;
            return (
              <View key={c.category} style={styles.catRow}>
                <View style={styles.catHead}>
                  <Text style={styles.catName}>
                    {iconForCategory(c.category)}  {c.category}
                  </Text>
                  <Text style={styles.catAmount}>{formatCurrency(c.total)}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${barPct}%` }]} />
                </View>
                <Text style={styles.catMeta}>
                  {pct.toFixed(0)}% · {c.count} item{c.count === 1 ? "" : "s"}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* All months overview */}
      <Text style={styles.sectionTitle}>All months</Text>
      {allMonths.length === 0 ? (
        <Text style={styles.muted}>No expenses yet.</Text>
      ) : (
        <View style={styles.card}>
          {allMonths.map((g) => {
            const selected = g.key === month;
            return (
              <Pressable
                key={g.key}
                style={[styles.monthItem, selected && styles.monthItemOn]}
                onPress={() => setMonth(g.key)}
              >
                <Text
                  style={[styles.monthItemLabel, selected && styles.monthItemLabelOn]}
                >
                  {monthLabel(g.key)}
                </Text>
                <Text
                  style={[styles.monthItemAmount, selected && styles.monthItemLabelOn]}
                >
                  {formatCurrency(g.total)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  banner: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerText: { color: colors.primary, fontSize: 12 },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    marginTop: spacing.sm,
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
  total: {
    fontSize: 34,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  totalCaption: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  catRow: { gap: spacing.xs },
  catHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  catName: { fontSize: 15, fontWeight: "600", color: colors.text },
  catAmount: { fontSize: 15, fontWeight: "700", color: colors.text },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primarySoft,
    overflow: "hidden",
  },
  barFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  catMeta: { fontSize: 12, color: colors.textMuted },
  muted: { color: colors.textMuted, fontSize: 14 },
  monthItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  monthItemOn: { backgroundColor: colors.primarySoft },
  monthItemLabel: { fontSize: 15, color: colors.text },
  monthItemLabelOn: { color: colors.primary, fontWeight: "700" },
  monthItemAmount: { fontSize: 15, fontWeight: "600", color: colors.text },
});
