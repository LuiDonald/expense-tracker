// Search + filter over expenses (pure functions, no UI or store state).
//
// Text search: every word in the query must match somewhere in the expense —
// merchant, note, or category (case-insensitive). A word that looks like money
// ("45", "$45.1", "12.99") also matches amounts that start with it, so "45"
// finds $45.00 and $45.99 but not $145.00.

import { Expense } from "../types/expense";
import { UNCATEGORIZED } from "./categories";
import { monthKey } from "../lib/format";

export interface ExpenseFilter {
  /** Free text; empty means no text filter. */
  query: string;
  /** Exact category name (case-insensitive); null means any category. */
  category: string | null;
}

export interface SearchMonthGroup {
  key: string; // "YYYY-MM"
  total: number;
  expenses: Expense[];
}

export interface SearchResult {
  count: number;
  total: number;
  months: SearchMonthGroup[];
}

const MONEY_RE = /^\$?\d+(\.\d{0,2})?$/;

export function isFilterActive(f: ExpenseFilter): boolean {
  return f.query.trim() !== "" || f.category !== null;
}

function categoryOf(e: Expense): string {
  return e.category || UNCATEGORIZED;
}

function matchesWord(e: Expense, word: string): boolean {
  const haystack = `${e.merchant} ${e.note} ${categoryOf(e)}`.toLowerCase();
  if (haystack.includes(word)) return true;
  if (MONEY_RE.test(word)) {
    const digits = word.replace("$", "");
    return (e.amount || 0).toFixed(2).startsWith(digits);
  }
  return false;
}

export function matchesFilter(e: Expense, f: ExpenseFilter): boolean {
  if (f.category !== null && categoryOf(e).toLowerCase() !== f.category.toLowerCase()) {
    return false;
  }
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => matchesWord(e, w));
}

/** Matching expenses across all months, grouped newest month first. */
export function searchExpenses(expenses: Expense[], f: ExpenseFilter): SearchResult {
  const byMonth = new Map<string, Expense[]>();
  let total = 0;
  let count = 0;
  for (const e of expenses) {
    if (!matchesFilter(e, f)) continue;
    const k = monthKey(e.date);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(e);
    total += e.amount || 0;
    count += 1;
  }
  const months = Array.from(byMonth.entries())
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
      return { key, total: sorted.reduce((s, e) => s + (e.amount || 0), 0), expenses: sorted };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
  return { count, total, months };
}

/** Categories present in the data, most-used first (for the filter chips). */
export function categoriesInUse(expenses: Expense[]): string[] {
  const counts = new Map<string, number>();
  for (const e of expenses) {
    const c = categoryOf(e);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c]) => c);
}
