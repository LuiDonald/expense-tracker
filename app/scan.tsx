// Scan several receipts at once: pick photos, each is scanned in the
// background, you review/fix the fields, then save them all in one go.
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { expenseStore, useExpenses } from "../src/data/expenseStore";
import { CATEGORIES } from "../src/data/categories";
import { findLikelyDuplicates } from "../src/data/duplicates";
import { pickImagesFromLibrary } from "../src/lib/imagePicker";
import { parseReceiptImage } from "../src/lib/parseReceipt";
import { isSupabaseConfigured } from "../src/lib/supabase";
import { alertDialog } from "../src/lib/dialogs";
import { formatCurrency, formatDate } from "../src/lib/format";
import { Expense, todayISODate } from "../src/types/expense";
import { colors, maxContentWidth, radius, spacing } from "../src/lib/theme";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCAN_CONCURRENCY = 2;

type Status = "queued" | "scanning" | "ready" | "failed" | "saving";

interface Item {
  key: string;
  uri: string;
  status: Status;
  error?: string;
  merchant: string;
  amountText: string;
  date: string;
  category: string;
  note: string;
}

function parseAmount(text: string): number {
  const n = parseFloat(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Why this item can't be saved yet, or null if it's fine. */
function problem(item: Item): string | null {
  if (!item.merchant.trim()) return "Add the merchant";
  if (parseAmount(item.amountText) <= 0) return "Add the amount";
  if (!DATE_RE.test(item.date)) return "Date must be YYYY-MM-DD";
  return null;
}

let keySeq = 0;

export default function ScanReceiptsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { expenses } = useExpenses();
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const queue = useRef<string[]>([]);
  const uriByKey = useRef(new Map<string, string>());
  const running = useRef(0);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const remove = (key: string) => setItems((list) => list.filter((it) => it.key !== key));

  // Scan up to SCAN_CONCURRENCY photos at a time; the rest wait in the queue.
  const pump = () => {
    while (running.current < SCAN_CONCURRENCY && queue.current.length > 0) {
      const key = queue.current.shift()!;
      const uri = uriByKey.current.get(key);
      if (!uri) continue;
      running.current += 1;
      update(key, { status: "scanning" });
      parseReceiptImage(uri)
        .then((p) => {
          const got = p.merchant || p.amount > 0 || p.date;
          setItems((list) =>
            list.map((it) =>
              it.key !== key
                ? it
                : {
                    ...it,
                    status: got ? "ready" : "failed",
                    error: got ? undefined : "Didn't look like a receipt. Fill it in below.",
                    merchant: p.merchant || it.merchant,
                    amountText: p.amount > 0 ? String(p.amount) : it.amountText,
                    date: DATE_RE.test(p.date) ? p.date : it.date,
                    category: p.category || it.category,
                    note: p.note || it.note,
                  }
            )
          );
        })
        .catch((e: any) =>
          update(key, { status: "failed", error: e?.message ?? "Scan failed" })
        )
        .finally(() => {
          running.current -= 1;
          pump();
        });
    }
  };

  const onPick = async () => {
    const uris = await pickImagesFromLibrary();
    if (uris.length === 0) return;
    const added: Item[] = uris.map((uri) => ({
      key: `scan-${++keySeq}`,
      uri,
      status: isSupabaseConfigured ? "queued" : "failed",
      error: isSupabaseConfigured ? undefined : "Scanning needs Supabase. Fill it in below.",
      merchant: "",
      amountText: "",
      date: todayISODate(),
      category: "",
      note: "",
    }));
    setItems((list) => [...list, ...added]);
    for (const a of added) uriByKey.current.set(a.key, a.uri);
    if (isSupabaseConfigured) {
      queue.current.push(...added.map((a) => a.key));
      pump();
    }
  };

  const busy = items.some((it) => it.status === "queued" || it.status === "scanning");
  const invalid = items.filter((it) => problem(it) !== null).length;
  const canSave = items.length > 0 && !busy && invalid === 0 && !saving;

  // Duplicate warnings: against saved expenses, and against earlier items in this batch.
  const dupeNotes = useMemo(() => {
    const notes = new Map<string, string>();
    items.forEach((it, i) => {
      const cand = { merchant: it.merchant, amount: parseAmount(it.amountText), date: it.date };
      const saved = findLikelyDuplicates(expenseStore.getAll(), cand)[0];
      if (saved) {
        const e = saved.expense;
        notes.set(
          it.key,
          `Possible duplicate: ${e.merchant || "an expense"} ${formatCurrency(e.amount)} on ${formatDate(e.date)}`
        );
        return;
      }
      const earlier: Expense[] = items.slice(0, i).map((o) => ({
        id: o.key,
        merchant: o.merchant,
        amount: parseAmount(o.amountText),
        date: o.date,
        category: o.category,
        note: o.note,
        photoUrl: null,
        createdAt: "",
        updatedAt: "",
      }));
      const inBatch = findLikelyDuplicates(earlier, cand)[0];
      if (inBatch) {
        const n = items.findIndex((o) => o.key === inBatch.expense.id) + 1;
        notes.set(it.key, `Looks like the same receipt as #${n} above`);
      }
    });
    return notes;
  }, [items, expenses]);

  const onSaveAll = async () => {
    if (!canSave) return;
    setSaving(true);
    let failed = 0;
    for (const it of items) {
      update(it.key, { status: "saving", error: undefined });
      try {
        await expenseStore.create({
          merchant: it.merchant.trim(),
          amount: parseAmount(it.amountText),
          category: it.category.trim(),
          date: it.date,
          note: it.note.trim(),
          photoUrl: it.uri,
        });
        remove(it.key);
      } catch (e: any) {
        failed += 1;
        update(it.key, { status: "failed", error: `Couldn't save: ${e?.message ?? "error"}` });
      }
    }
    setSaving(false);
    if (failed === 0) {
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } else {
      alertDialog("Some didn't save", `${failed} expense${failed === 1 ? "" : "s"} couldn't be saved. They're still listed so you can retry.`);
    }
  };

  const saveLabel = saving
    ? "Saving…"
    : busy
      ? "Scanning…"
      : `Save ${items.length} expense${items.length === 1 ? "" : "s"}`;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: "Scan receipts" }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.pickBtn} onPress={onPick} disabled={saving}>
          <Text style={styles.pickBtnText}>
            {items.length === 0 ? "Choose receipt photos" : "Add more photos"}
          </Text>
        </Pressable>
        {items.length === 0 && (
          <Text style={styles.help}>
            Pick several receipts at once. Each one is scanned automatically, then
            you can check the details and save them all together.
          </Text>
        )}

        {items.map((it, i) => (
          <View key={it.key} style={styles.card}>
            <View style={styles.cardTop}>
              <Image source={{ uri: it.uri }} style={styles.thumb} />
              <View style={styles.cardStatus}>
                <Text style={styles.cardIndex}>#{i + 1}</Text>
                <StatusLine item={it} />
              </View>
              <Pressable
                onPress={() => remove(it.key)}
                disabled={saving}
                hitSlop={10}
                accessibilityLabel={`Remove receipt ${i + 1}`}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>

            {dupeNotes.get(it.key) && (
              <Text style={styles.warn}>⚠️ {dupeNotes.get(it.key)}</Text>
            )}

            <View style={styles.fieldRow}>
              <TextInput
                style={[styles.input, { flex: 2 }]}
                value={it.merchant}
                onChangeText={(t) => update(it.key, { merchant: t })}
                placeholder="Merchant"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={`Merchant for receipt ${i + 1}`}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={it.amountText}
                onChangeText={(t) => update(it.key, { amountText: t })}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel={`Amount for receipt ${i + 1}`}
              />
            </View>
            <View style={styles.fieldRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={it.date}
                onChangeText={(t) => update(it.key, { date: t })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                accessibilityLabel={`Date for receipt ${i + 1}`}
              />
              <TextInput
                style={[styles.input, { flex: 2 }]}
                value={it.note}
                onChangeText={(t) => update(it.key, { note: t })}
                placeholder="Note (optional)"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={`Note for receipt ${i + 1}`}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {CATEGORIES.map((c) => {
                const on = it.category.toLowerCase() === c.name.toLowerCase();
                return (
                  <Pressable
                    key={c.name}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => update(it.key, { category: on ? "" : c.name })}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                      {c.icon} {c.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {it.status !== "queued" && it.status !== "scanning" && problem(it) && (
              <Text style={styles.problem}>{problem(it)}</Text>
            )}
          </View>
        ))}
      </ScrollView>

      {items.length > 0 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          {invalid > 0 && !busy && (
            <Text style={styles.footerNote}>
              {invalid} receipt{invalid === 1 ? " needs" : "s need"} a fix before saving
            </Text>
          )}
          <Pressable
            style={[styles.saveBtn, !canSave && styles.saveBtnOff]}
            onPress={onSaveAll}
            disabled={!canSave}
          >
            <Text style={styles.saveBtnText}>{saveLabel}</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function StatusLine({ item }: { item: Item }) {
  switch (item.status) {
    case "queued":
      return <Text style={styles.statusMuted}>Waiting to scan…</Text>;
    case "scanning":
      return (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.statusMuted}>Scanning…</Text>
        </View>
      );
    case "saving":
      return <Text style={styles.statusMuted}>Saving…</Text>;
    case "failed":
      return <Text style={styles.statusError}>{item.error ?? "Scan failed"}</Text>;
    default:
      return <Text style={styles.statusOk}>Scanned ✓ Check the details</Text>;
  }
}

const styles = StyleSheet.create({
  content: {
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  pickBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  pickBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  help: { color: colors.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  cardStatus: { flex: 1, gap: 2 },
  cardIndex: { fontSize: 13, fontWeight: "700", color: colors.text },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  statusMuted: { fontSize: 13, color: colors.textMuted },
  statusOk: { fontSize: 13, color: colors.success, fontWeight: "600" },
  statusError: { fontSize: 13, color: colors.danger },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  warn: {
    fontSize: 13,
    color: "#8A5A00",
    backgroundColor: "#FFF4DB",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  fieldRow: { flexDirection: "row", gap: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.bg,
    minWidth: 0,
  },
  chips: { gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text },
  chipTextOn: { color: colors.primary, fontWeight: "700" },
  problem: { fontSize: 12, color: colors.danger },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: "center",
    gap: spacing.xs,
  },
  footerNote: { fontSize: 12, color: colors.danger },
  saveBtn: {
    width: "100%",
    maxWidth: maxContentWidth - spacing.lg * 2,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  saveBtnOff: { opacity: 0.45 },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
