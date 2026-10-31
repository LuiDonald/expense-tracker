// Core data model for an expense.
// This shape maps 1:1 to the `expenses` table in Supabase (see supabase/schema.sql).

export interface Expense {
  id: string;
  /** Where the money was spent (e.g. "Costco", "Shell"). */
  merchant: string;
  /** Amount in dollars (e.g. 42.19). Stored as numeric(12,2) in Postgres. */
  amount: number;
  /** The spending category (e.g. "Groceries", "Car"). */
  category: string;
  /** The date the expense happened, as an ISO calendar date: "YYYY-MM-DD". */
  date: string;
  /** Optional free-text note (e.g. "weekly shop", "oil change"). */
  note: string;
  /** Public URL (Supabase Storage) or a local/remote image URI of the receipt. */
  photoUrl: string | null;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

/** Fields the user can edit in the create/edit form. */
export type ExpenseDraft = Omit<Expense, "id" | "createdAt" | "updatedAt">;

/** Today's date as "YYYY-MM-DD" in the device's local timezone. */
export function todayISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function emptyDraft(category = ""): ExpenseDraft {
  return {
    merchant: "",
    amount: 0,
    category,
    date: todayISODate(),
    note: "",
    photoUrl: null,
  };
}
