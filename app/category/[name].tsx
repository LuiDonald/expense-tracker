import { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useExpenses, expenseStore } from "../../src/data/expenseStore";
import { iconForCategory } from "../../src/data/categories";
import {
  formatCurrency,
  formatDate,
  monthKey,
  monthLabel,
} from "../../src/lib/format";
import { colors, maxContentWidth, radius, spacing } from "../../src/lib/theme";

export default function CategoryDetailScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const category = decodeURIComponent(name ?? "");
  const { expenses } = useExpenses();

  // All expenses in this category, grouped by month (newest month first).
  const { total, count, months } = useMemo(() => {
    const list = expenseStore.getByCategory(category);
    const map = new Map<string, { key: string; total: number; expenses: typeof list }>();
    for (const e of list) {
      const k = monthKey(e.date);
      if (!map.has(k)) map.set(k, { key: k, total: 0, expenses: [] });
      const g = map.get(k)!;
      g.total += e.amount || 0;
      g.expenses.push(e);
    }
    const months = Array.from(map.values())
      .map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
      .sort((a, b) => b.key.localeCompare(a.key));
    const total = list.reduce((s, e) => s + (e.amount || 0), 0);
    return { total: Math.round(total * 100) / 100, count: list.length, months };
  }, [expenses, category]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: category || "Category",
          headerLeft: () => (
            <Pressable
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/categories")
              }
              hitSlop={12}
              style={styles.backBtn}
            >
              <Text style={styles.backText}>‹ Back</Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.hero}>
        <Text style={styles.icon}>{iconForCategory(category)}</Text>
        <Text style={styles.total}>{formatCurrency(total)}</Text>
        <Text style={styles.caption}>
          {count} expense{count === 1 ? "" : "s"} all-time in {category || "Uncategorized"}
        </Text>
      </View>

      {months.length === 0 ? (
        <Text style={styles.empty}>No expenses in this category yet.</Text>
      ) : (
        months.map((m) => (
          <View key={m.key} style={styles.monthBlock}>
            <View style={styles.monthHeader}>
              <Text style={styles.monthLabel}>{monthLabel(m.key)}</Text>
              <Text style={styles.monthTotal}>{formatCurrency(m.total)}</Text>
            </View>
            <View style={styles.card}>
              {m.expenses.map((e, i) => (
                <Pressable
                  key={e.id}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() => router.push(`/expense/${e.id}`)}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {e.merchant || "Unknown merchant"}
                    </Text>
                    <Text style={styles.rowSubtitle} numberOfLines={1}>
                      {formatDate(e.date)}
                      {e.note ? ` · ${e.note}` : ""}
                    </Text>
                  </View>
                  <Text style={styles.amount}>{formatCurrency(e.amount)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))
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
    paddingBottom: spacing.xl * 2,
  },
  backBtn: { paddingHorizontal: spacing.sm },
  backText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  hero: { alignItems: "center", paddingVertical: spacing.lg, gap: spacing.xs },
  icon: { fontSize: 40 },
  total: { fontSize: 34, fontWeight: "800", color: colors.text, marginTop: spacing.sm },
  caption: { fontSize: 13, color: colors.textMuted },
  monthBlock: { marginTop: spacing.lg },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  monthLabel: { fontSize: 16, fontWeight: "700", color: colors.text },
  monthTotal: { fontSize: 16, fontWeight: "700", color: colors.text },
  card: {
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
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.xl },
});
