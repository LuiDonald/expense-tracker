import { useEffect, useMemo, useState } from "react";
import {
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
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { expenseStore } from "../../src/data/expenseStore";
import { emptyDraft, ExpenseDraft, todayISODate } from "../../src/types/expense";
import { CATEGORIES } from "../../src/data/categories";
import {
  pickImageFromLibrary,
  takePhoto,
} from "../../src/lib/imagePicker";
import { isSupabaseConfigured } from "../../src/lib/supabase";
import { useAuth } from "../../src/lib/auth";
import { parseReceiptImage } from "../../src/lib/parseReceipt";
import { alertDialog } from "../../src/lib/dialogs";
import { isLocalPhoto } from "../../src/lib/storage";
import { colors, maxContentWidth, radius, spacing } from "../../src/lib/theme";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === "new";
  const { isOwner, ready } = useAuth();

  // Guard: only the owner can reach the editor (demo mode is open for trying it
  // out). Bounce everyone else once the auth state has resolved.
  useEffect(() => {
    if (isSupabaseConfigured && ready && !isOwner) {
      router.replace("/account");
    }
  }, [ready, isOwner, router]);

  const existing = useMemo(
    () => (isNew ? undefined : expenseStore.getById(id)),
    [id, isNew]
  );

  const [draft, setDraft] = useState<ExpenseDraft>(() =>
    existing
      ? {
          merchant: existing.merchant,
          amount: existing.amount,
          category: existing.category,
          date: existing.date,
          note: existing.note,
          photoUrl: existing.photoUrl,
        }
      : emptyDraft()
  );
  const [amountText, setAmountText] = useState(
    existing && existing.amount ? String(existing.amount) : ""
  );
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const patch = (p: Partial<ExpenseDraft>) => setDraft((d) => ({ ...d, ...p }));

  // Category chips: the canonical list, plus the current category if it isn't
  // one of them (so a custom one set by the agent still shows selected).
  const categoryChips = useMemo(() => {
    const chips = CATEGORIES.map((c) => ({ name: c.name, icon: c.icon }));
    const current = draft.category.trim();
    if (current && !chips.some((c) => c.name.toLowerCase() === current.toLowerCase())) {
      chips.push({ name: current, icon: "📁" });
    }
    return chips;
  }, [draft.category]);

  const onPickImage = async () => {
    const uri = await pickImageFromLibrary();
    if (uri) patch({ photoUrl: uri });
  };
  const onTakePhoto = async () => {
    const uri = await takePhoto();
    if (uri) patch({ photoUrl: uri });
  };

  const onScan = async () => {
    if (!draft.photoUrl || scanning) return;
    setScanning(true);
    try {
      const p = await parseReceiptImage(draft.photoUrl);
      const gotSomething = p.merchant || p.amount > 0 || p.date;
      if (!gotSomething) {
        alertDialog(
          "Nothing detected",
          "That photo didn't look like a receipt. Try a clearer photo or fill the fields in manually."
        );
        return;
      }
      setDraft((d) => ({
        ...d,
        merchant: p.merchant || d.merchant,
        category: p.category || d.category,
        date: DATE_RE.test(p.date) ? p.date : d.date,
        note: p.note || d.note,
        amount: p.amount > 0 ? p.amount : d.amount,
      }));
      if (p.amount > 0) setAmountText(String(p.amount));
    } catch (e: any) {
      alertDialog("Couldn't scan", e?.message ?? "Unknown error");
    } finally {
      setScanning(false);
    }
  };

  const willUploadPhoto =
    isSupabaseConfigured && !!draft.photoUrl && isLocalPhoto(draft.photoUrl);
  const busyLabel = willUploadPhoto ? "Uploading…" : "Saving…";

  const onSave = async () => {
    const merchant = draft.merchant.trim();
    const amount = parseFloat(amountText.replace(/[^0-9.]/g, ""));
    if (!merchant) {
      alertDialog("Merchant required", "Enter where the money was spent.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      alertDialog("Amount required", "Enter a dollar amount greater than 0.");
      return;
    }
    if (!DATE_RE.test(draft.date)) {
      alertDialog("Check the date", "Use the format YYYY-MM-DD (e.g. 2026-10-31).");
      return;
    }
    setSaving(true);
    try {
      const cleaned: ExpenseDraft = {
        ...draft,
        merchant,
        amount: Math.round(amount * 100) / 100,
        category: draft.category.trim(),
        note: draft.note.trim(),
      };
      if (isNew) {
        const created = await expenseStore.create(cleaned);
        router.replace(`/expense/${created.id}`);
      } else {
        await expenseStore.update(id, cleaned);
        router.back();
      }
    } catch (e: any) {
      alertDialog("Could not save", e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen
        options={{
          title: isNew ? "New Expense" : "Edit Expense",
          headerRight: () => (
            <Pressable onPress={onSave} disabled={saving} hitSlop={12}>
              <Text style={[styles.headerAction, saving && { opacity: 0.5 }]}>
                {saving ? busyLabel : "Save"}
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Receipt photo + scan */}
        {draft.photoUrl ? (
          <Image source={{ uri: draft.photoUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.muted}>No receipt photo yet</Text>
          </View>
        )}
        <View style={styles.photoActions}>
          <Pressable style={styles.secondaryBtn} onPress={onPickImage}>
            <Text style={styles.secondaryBtnText}>Choose photo</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={onTakePhoto}>
            <Text style={styles.secondaryBtnText}>Take photo</Text>
          </Pressable>
        </View>

        {isSupabaseConfigured && (
          <View style={styles.scanCard}>
            <Text style={styles.scanTitle}>✨ Scan the receipt to auto-fill</Text>
            <Text style={styles.scanHint}>
              Add a photo of a receipt or a gas-station sales screen above, then
              tap Scan. AI reads the merchant, amount, date, and a category.
              Review the fields before saving.
            </Text>
            <Pressable
              style={[
                styles.scanBtn,
                (scanning || !draft.photoUrl) && { opacity: 0.6 },
              ]}
              onPress={onScan}
              disabled={scanning || !draft.photoUrl}
            >
              <Text style={styles.scanBtnText}>
                {scanning ? "Scanning…" : "Scan receipt"}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Amount */}
        <Field label="Amount">
          <View style={styles.amountWrap}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              style={[styles.input, styles.amountInput]}
              value={amountText}
              onChangeText={(t) => setAmountText(t)}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </View>
        </Field>

        {/* Merchant */}
        <Field label="Merchant">
          <TextInput
            style={styles.input}
            value={draft.merchant}
            onChangeText={(t) => patch({ merchant: t })}
            placeholder="e.g. Costco, Shell, Amazon"
            placeholderTextColor={colors.textMuted}
          />
        </Field>

        {/* Category */}
        <Field label="Category">
          <View style={styles.chipWrap}>
            {categoryChips.map((c) => {
              const selected =
                draft.category.toLowerCase() === c.name.toLowerCase();
              return (
                <Pressable
                  key={c.name}
                  onPress={() => patch({ category: c.name })}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text
                    style={[styles.chipText, selected && styles.chipTextSelected]}
                  >
                    {c.icon} {c.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        {/* Date */}
        <Field label="Date">
          <View style={styles.dateRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={draft.date}
              onChangeText={(t) => patch({ date: t })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
            />
            <Pressable
              style={styles.todayBtn}
              onPress={() => patch({ date: todayISODate() })}
            >
              <Text style={styles.todayText}>Today</Text>
            </Pressable>
          </View>
        </Field>

        {/* Note */}
        <Field label="Note (optional)">
          <TextInput
            style={[styles.input, styles.multiline]}
            value={draft.note}
            onChangeText={(t) => patch({ note: t })}
            placeholder="e.g. weekly shop, oil change…"
            placeholderTextColor={colors.textMuted}
            multiline
          />
        </Field>

        <Pressable
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={onSave}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>
            {saving ? busyLabel : "Save expense"}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
  },
  headerAction: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  photo: {
    width: "100%",
    height: 220,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    resizeMode: "contain",
  },
  photoPlaceholder: { alignItems: "center", justifyContent: "center" },
  photoActions: { flexDirection: "row", gap: spacing.md },
  secondaryBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
  },
  secondaryBtnText: { color: colors.primary, fontWeight: "600" },
  scanCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  scanTitle: { fontSize: 15, fontWeight: "700", color: colors.primary },
  scanHint: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  scanBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: "center",
  },
  scanBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  field: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: "700", color: colors.text },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  amountWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  currency: { fontSize: 24, fontWeight: "700", color: colors.textMuted },
  amountInput: { flex: 1, fontSize: 22, fontWeight: "700" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  chipText: { fontSize: 13, color: colors.textMuted },
  chipTextSelected: { color: colors.primary, fontWeight: "700" },
  dateRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  todayBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  todayText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  muted: { color: colors.textMuted },
  saveBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
