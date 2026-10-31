import { useMemo } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useExpenses, expenseStore } from "../../src/data/expenseStore";
import { iconForCategory } from "../../src/data/categories";
import { isSupabaseConfigured } from "../../src/lib/supabase";
import { useAuth, REQUIRE_LOGIN } from "../../src/lib/auth";
import { formatCurrency } from "../../src/lib/format";
import { colors, maxContentWidth, radius, spacing } from "../../src/lib/theme";
import { Locked } from "../../src/components/Locked";

export default function CategoriesScreen() {
  const router = useRouter();
  const { expenses } = useExpenses();
  const { isOwner, ready } = useAuth();

  const locked = REQUIRE_LOGIN && isSupabaseConfigured && ready && !isOwner;

  const totals = useMemo(() => expenseStore.allCategoryTotals(), [expenses]);
  const grandTotal = useMemo(
    () => totals.reduce((s, c) => s + c.total, 0),
    [totals]
  );

  if (locked) return <Locked />;

  return (
    <View style={styles.container}>
      {!isSupabaseConfigured && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Demo mode — sample expenses.</Text>
        </View>
      )}

      <FlatList
        data={totals}
        keyExtractor={(item) => item.category}
        style={styles.centeredList}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.headerCaption}>All-time spending by category</Text>
            <Text style={styles.headerTotal}>{formatCurrency(grandTotal)}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const pct = grandTotal > 0 ? (item.total / grandTotal) * 100 : 0;
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() =>
                router.push(`/category/${encodeURIComponent(item.category)}`)
              }
            >
              <View style={styles.iconTile}>
                <Text style={styles.iconText}>
                  {iconForCategory(item.category)}
                </Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.category}</Text>
                <Text style={styles.rowSubtitle}>
                  {item.count} expense{item.count === 1 ? "" : "s"} · {pct.toFixed(0)}%
                </Text>
              </View>
              <Text style={styles.amount}>{formatCurrency(item.total)}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>No expenses yet.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  banner: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  bannerText: { color: colors.primary, fontSize: 12 },
  centeredList: { width: "100%", maxWidth: maxContentWidth, alignSelf: "center" },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 120 },
  header: { alignItems: "center", marginBottom: spacing.lg, gap: spacing.xs },
  headerCaption: { fontSize: 13, color: colors.textMuted },
  headerTotal: { fontSize: 30, fontWeight: "800", color: colors.text },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  rowPressed: { opacity: 0.8 },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { fontSize: 22 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 13, color: colors.textMuted },
  amount: { fontSize: 16, fontWeight: "700", color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.xl },
});
