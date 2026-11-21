// Month-over-month comparison (pure functions, no UI or store state).
//
// For a finished month we compare it with the whole previous month. For the
// month that's still in progress we compare like with like: this month so far
// vs. the SAME days of last month (e.g. Nov 1–20 vs. Oct 1–20). Otherwise the
// current month would always look cheaper just because it isn't over yet.

import { Expense } from "../types/expense";
import { UNCATEGORIZED } from "./categories";
import { monthKey, shiftMonth } from "../lib/format";

export interface CategoryChange {
  category: string;
  current: number;
  previous: number;
  /** current - previous (positive = spent more). */
  delta: number;
  /** Percent change, or null when there was nothing to compare against. */
  pct: number | null;
}

export interface MonthComparison {
  month: string; // "YYYY-MM"
  previousMonth: string; // "YYYY-MM"
  current: number;
  previous: number;
  delta: number;
  pct: number | null;
  /** Set when `month` is in progress: previous is limited to days 1..throughDay. */
  throughDay: number | null;
  /** Every category in either month, biggest absolute change first. */
  categories: CategoryChange[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function dayOf(dateISO: string): number {
  return parseInt(dateISO.slice(8, 10), 10) || 0;
}

export function compareMonths(
  expenses: Expense[],
  month: string,
  today: Date = new Date()
): MonthComparison {
  const previousMonth = shiftMonth(month, -1);
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const throughDay = month === todayKey ? today.getDate() : null;

  const cur = new Map<string, number>();
  const prev = new Map<string, number>();
  for (const e of expenses) {
    const k = monthKey(e.date);
    const cat = e.category || UNCATEGORIZED;
    const amt = e.amount || 0;
    if (k === month) {
      cur.set(cat, (cur.get(cat) ?? 0) + amt);
    } else if (k === previousMonth) {
      if (throughDay !== null && dayOf(e.date) > throughDay) continue;
      prev.set(cat, (prev.get(cat) ?? 0) + amt);
    }
  }

  const names = new Set([...cur.keys(), ...prev.keys()]);
  const categories: CategoryChange[] = Array.from(names)
    .map((category) => {
      const current = round2(cur.get(category) ?? 0);
      const previous = round2(prev.get(category) ?? 0);
      return {
        category,
        current,
        previous,
        delta: round2(current - previous),
        pct: pctChange(current, previous),
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.category.localeCompare(b.category));

  const current = round2(categories.reduce((s, c) => s + c.current, 0));
  const previous = round2(categories.reduce((s, c) => s + c.previous, 0));
  return {
    month,
    previousMonth,
    current,
    previous,
    delta: round2(current - previous),
    pct: pctChange(current, previous),
    throughDay,
    categories,
  };
}

/** Short human phrase for a change, e.g. "up 30%", "down $12.50", "new". */
export function describeChange(
  delta: number,
  pct: number | null,
  formatMoney: (n: number) => string
): string {
  if (Math.abs(delta) < 0.005) return "no change";
  const dir = delta > 0 ? "up" : "down";
  if (pct === null) return `new · ${formatMoney(delta)}`;
  if (pct <= -99.5) return `down ${formatMoney(-delta)} (none this month)`;
  return `${dir} ${Math.abs(pct).toFixed(0)}% (${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))})`;
}
