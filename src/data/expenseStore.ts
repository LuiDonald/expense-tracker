import { useEffect, useState } from "react";
import { Expense, ExpenseDraft } from "../types/expense";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  uploadReceiptPhoto,
  deleteReceiptPhoto,
  isLocalPhoto,
} from "../lib/storage";
import { monthKey } from "../lib/format";
import { MOCK_EXPENSES } from "./mockExpenses";

/**
 * A tiny observable repository for expenses.
 *
 * - When Supabase is NOT configured, it operates on an in-memory copy of the
 *   mock expenses (edits persist for the session so the app feels real).
 * - When Supabase IS configured, it reads/writes the `expenses` table. Because
 *   this is a private app, Row Level Security only returns rows to the signed-in
 *   owner — an empty list is what a logged-out visitor sees.
 *
 * UI subscribes via the `useExpenses` / `useExpense` hooks below.
 */

type Listener = () => void;

/** A month bucket: its "YYYY-MM" key, total, and the expenses within it. */
export interface MonthGroup {
  key: string;
  total: number;
  expenses: Expense[];
}

/** A category rollup within some set of expenses. */
export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
}

/** A category rollup that also carries the expenses inside it. */
export interface CategoryGroup extends CategoryTotal {
  expenses: Expense[];
}

class ExpenseStore {
  private expenses: Expense[] = MOCK_EXPENSES.map((e) => ({ ...e }));
  private listeners = new Set<Listener>();
  private loaded = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** All expenses, newest spending date first. */
  getAll(): Expense[] {
    return this.expenses;
  }

  getById(id: string): Expense | undefined {
    return this.expenses.find((e) => e.id === id);
  }

  /** Whether the initial Supabase fetch has completed. */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Expenses whose date falls in the given "YYYY-MM" month. */
  getByMonth(key: string): Expense[] {
    return this.getAll().filter((e) => monthKey(e.date) === key);
  }

  /** All month keys present in the data, newest first. */
  monthKeys(): string[] {
    const set = new Set(this.getAll().map((e) => monthKey(e.date)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }

  /** Expenses grouped by month, newest month first, newest date first within. */
  groupedByMonth(): MonthGroup[] {
    const map = new Map<string, Expense[]>();
    for (const e of this.getAll()) {
      const k = monthKey(e.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries())
      .map(([key, expenses]) => {
        const sorted = [...expenses].sort((a, b) => b.date.localeCompare(a.date));
        const total = sorted.reduce((sum, e) => sum + (e.amount || 0), 0);
        return { key, total, expenses: sorted };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  /** Total spend for a given month. */
  monthTotal(key: string): number {
    return this.getByMonth(key).reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  /** Category rollup for a given month, biggest spend first. */
  categoryTotals(key: string): CategoryTotal[] {
    const map = new Map<string, CategoryTotal>();
    for (const e of this.getByMonth(key)) {
      const cat = e.category || "Uncategorized";
      if (!map.has(cat)) map.set(cat, { category: cat, total: 0, count: 0 });
      const c = map.get(cat)!;
      c.total += e.amount || 0;
      c.count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  /**
   * Expenses in a month grouped by category, biggest-spend category first,
   * newest date first within each category.
   */
  categoryGroups(key: string): CategoryGroup[] {
    const map = new Map<string, CategoryGroup>();
    for (const e of this.getByMonth(key)) {
      const cat = e.category || "Uncategorized";
      if (!map.has(cat)) {
        map.set(cat, { category: cat, total: 0, count: 0, expenses: [] });
      }
      const g = map.get(cat)!;
      g.total += e.amount || 0;
      g.count += 1;
      g.expenses.push(e);
    }
    const groups = Array.from(map.values());
    for (const g of groups) {
      g.total = Math.round(g.total * 100) / 100;
      g.expenses.sort((a, b) => b.date.localeCompare(a.date));
    }
    return groups.sort((a, b) => b.total - a.total);
  }

  /** All-time category rollup across every expense, biggest spend first. */
  allCategoryTotals(): CategoryTotal[] {
    const map = new Map<string, CategoryTotal>();
    for (const e of this.getAll()) {
      const cat = e.category || "Uncategorized";
      if (!map.has(cat)) map.set(cat, { category: cat, total: 0, count: 0 });
      const c = map.get(cat)!;
      c.total += e.amount || 0;
      c.count += 1;
    }
    const totals = Array.from(map.values());
    for (const c of totals) c.total = Math.round(c.total * 100) / 100;
    return totals.sort((a, b) => b.total - a.total);
  }

  /** Every expense in a category (case-insensitive), newest date first. */
  getByCategory(name: string): Expense[] {
    const target = (name || "Uncategorized").toLowerCase();
    return this.getAll()
      .filter((e) => (e.category || "Uncategorized").toLowerCase() === target)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /** All-time total for a category (case-insensitive). */
  categoryTotalAllTime(name: string): number {
    return this.getByCategory(name).reduce((s, e) => s + (e.amount || 0), 0);
  }

  /** Fetch from Supabase (if configured). Safe to call repeatedly. */
  async load(force = false): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return; // mock mode: nothing to load
    if (this.loaded && !force) return;

    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Failed to load expenses from Supabase:", error.message);
      return;
    }

    this.expenses = (data ?? []).map(fromRow);
    this.loaded = true;
    this.emit();
  }

  /**
   * When Supabase is configured, upload any local (not-yet-uploaded) receipt
   * photo and return a draft whose photoUrl is a public Storage URL. In demo
   * mode the local URI is kept as-is (persists for the session only).
   */
  private async withUploadedPhoto(draft: ExpenseDraft): Promise<ExpenseDraft> {
    if (isSupabaseConfigured && draft.photoUrl && isLocalPhoto(draft.photoUrl)) {
      const publicUrl = await uploadReceiptPhoto(draft.photoUrl);
      return { ...draft, photoUrl: publicUrl };
    }
    return draft;
  }

  async create(draft: ExpenseDraft): Promise<Expense> {
    const now = new Date().toISOString();
    const prepared = await this.withUploadedPhoto(draft);

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from("expenses")
        .insert(toRow(prepared))
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      const expense = fromRow(data);
      this.expenses = [expense, ...this.expenses];
      this.emit();
      return expense;
    }

    // mock mode
    const expense: Expense = {
      ...prepared,
      id: `local-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };
    this.expenses = [expense, ...this.expenses];
    this.emit();
    return expense;
  }

  async update(id: string, draft: ExpenseDraft): Promise<Expense> {
    const now = new Date().toISOString();
    const previousPhoto = this.getById(id)?.photoUrl ?? null;
    const prepared = await this.withUploadedPhoto(draft);

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from("expenses")
        .update({ ...toRow(prepared), updated_at: now })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      const updated = fromRow(data);
      this.expenses = this.expenses.map((e) => (e.id === id ? updated : e));
      this.emit();
      // Clean up the old photo if it was replaced.
      if (previousPhoto && previousPhoto !== updated.photoUrl) {
        void deleteReceiptPhoto(previousPhoto);
      }
      return updated;
    }

    // mock mode
    const existing = this.getById(id);
    const updated: Expense = {
      ...(existing as Expense),
      ...prepared,
      id,
      updatedAt: now,
    };
    this.expenses = this.expenses.map((e) => (e.id === id ? updated : e));
    this.emit();
    return updated;
  }

  /** Permanently delete an expense (and its receipt photo). */
  async remove(id: string): Promise<void> {
    const photo = this.getById(id)?.photoUrl ?? null;

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from("expenses")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error(
          "Delete was blocked — make sure you're logged in as the owner."
        );
      }
      void deleteReceiptPhoto(photo);
    }

    this.expenses = this.expenses.filter((e) => e.id !== id);
    this.emit();
  }

  /** Replace the in-memory list (used when auth changes / on sign-out). */
  reset(): void {
    this.loaded = false;
    if (!isSupabaseConfigured) {
      this.expenses = MOCK_EXPENSES.map((e) => ({ ...e }));
    } else {
      this.expenses = [];
    }
    this.emit();
  }
}

export const expenseStore = new ExpenseStore();

// ---- Row <-> Expense mapping (snake_case columns <-> camelCase model) ----

interface ExpenseRow {
  id: string;
  merchant: string | null;
  amount: number | string | null;
  category: string | null;
  date: string;
  note: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: ExpenseRow): Expense {
  const amount =
    typeof row.amount === "number"
      ? row.amount
      : parseFloat(String(row.amount ?? "")) || 0;
  return {
    id: row.id,
    merchant: row.merchant ?? "",
    amount,
    category: row.category ?? "",
    date: (row.date ?? "").slice(0, 10),
    note: row.note ?? "",
    photoUrl: row.photo_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(draft: ExpenseDraft) {
  return {
    merchant: draft.merchant,
    amount: draft.amount,
    category: draft.category,
    date: draft.date,
    note: draft.note,
    photo_url: draft.photoUrl,
  };
}

// ---- React hooks ----

export function useExpenses(): { expenses: Expense[]; reload: () => void } {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = expenseStore.subscribe(() => setTick((t) => t + 1));
    expenseStore.load();
    return unsub;
  }, []);

  return {
    expenses: expenseStore.getAll(),
    reload: () => expenseStore.load(true),
  };
}

export function useExpense(id: string | undefined): {
  expense: Expense | undefined;
  loading: boolean;
} {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = expenseStore.subscribe(() => setTick((t) => t + 1));
    expenseStore.load();
    return unsub;
  }, []);

  const expense = id ? expenseStore.getById(id) : undefined;
  const loading = isSupabaseConfigured && !expenseStore.isLoaded;
  return { expense, loading };
}
