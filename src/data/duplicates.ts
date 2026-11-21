// Likely-duplicate detection (pure functions, no UI or store state).
//
// A saved expense is flagged as a likely duplicate of a new one when the amount
// is the same (to the cent) and the dates are at most one day apart. The scan
// sometimes reads the date a day off, and the same receipt can be logged twice
// (once in the app, once through Muse). A similar merchant name makes it a
// "strong" match; amount + date alone is still worth a warning.

import { Expense } from "../types/expense";

export interface DuplicateCandidate {
  merchant: string;
  amount: number;
  date: string; // "YYYY-MM-DD"
}

export interface DuplicateMatch {
  expense: Expense;
  /** True when the merchant names also look alike. */
  strong: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(dateISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}

/** Lowercase letters and digits only: "Trader Joe's #123" -> "traderjoes123". */
function normalizeMerchant(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function merchantsLookAlike(a: string, b: string): boolean {
  const x = normalizeMerchant(a);
  const y = normalizeMerchant(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // One contains the other ("costco" vs "costcowholesale"), min 4 chars.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.includes(short);
}

/**
 * Saved expenses that look like the same purchase as `candidate`, strongest
 * first. Pass `excludeId` when editing so an expense doesn't match itself.
 */
export function findLikelyDuplicates(
  expenses: Expense[],
  candidate: DuplicateCandidate,
  excludeId?: string
): DuplicateMatch[] {
  const day = dayNumber(candidate.date);
  const cents = Math.round((candidate.amount || 0) * 100);
  if (day === null || cents <= 0) return [];

  const matches: DuplicateMatch[] = [];
  for (const e of expenses) {
    if (excludeId && e.id === excludeId) continue;
    if (Math.round((e.amount || 0) * 100) !== cents) continue;
    const d = dayNumber(e.date);
    if (d === null || Math.abs(d - day) > 1) continue;
    matches.push({ expense: e, strong: merchantsLookAlike(e.merchant, candidate.merchant) });
  }
  return matches.sort((a, b) => Number(b.strong) - Number(a.strong));
}
