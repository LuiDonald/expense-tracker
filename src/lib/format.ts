/** Money + date formatting helpers, shared across screens. */

/** Format a number as US dollars, e.g. 42.1 -> "$42.10". */
export function formatCurrency(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

/** "YYYY-MM" key for grouping an ISO date ("YYYY-MM-DD") by month. */
export function monthKey(dateISO: string): string {
  // ISO calendar date is already "YYYY-MM-DD"; take the first 7 chars.
  if (/^\d{4}-\d{2}/.test(dateISO)) return dateISO.slice(0, 7);
  const d = new Date(dateISO);
  if (isNaN(d.getTime())) return "0000-00";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10" -> "October 2026". */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  return `${MONTH_NAMES[monthIdx] ?? "?"} ${year}`;
}

/** "2026-10" -> "Oct 2026" (compact). */
export function monthLabelShort(key: string): string {
  const full = monthLabel(key);
  return full.replace(/^(\w{3})\w*/, "$1");
}

/** This month's key, e.g. "2026-10". */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Shift a "YYYY-MM" key by n months (n can be negative). */
export function shiftMonth(key: string, n: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  let year = parseInt(m[1], 10);
  let month = parseInt(m[2], 10) - 1 + n; // 0-indexed
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** "2026-10-31" -> "Oct 31, 2026". */
export function formatDate(dateISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO);
  if (m) {
    const year = m[1];
    const monthIdx = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const short = (MONTH_NAMES[monthIdx] ?? "").slice(0, 3);
    return `${short} ${day}, ${year}`;
  }
  const d = new Date(dateISO);
  if (isNaN(d.getTime())) return dateISO;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
