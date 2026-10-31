// Canonical list of expense categories. You said these will be refined later —
// this is just a sensible starting set. Add/rename freely; any category that
// shows up in your data but isn't listed here still works (it just falls back
// to the 📁 icon).

export interface Category {
  name: string;
  /** Emoji used as the category icon. */
  icon: string;
}

export const CATEGORIES: Category[] = [
  { name: "Groceries", icon: "🛒" },
  { name: "Car", icon: "🚗" },
  { name: "Gas", icon: "⛽" },
  { name: "Shopping", icon: "🛍️" },
  { name: "Dining", icon: "🍽️" },
  { name: "Utilities", icon: "💡" },
  { name: "Health", icon: "💊" },
  { name: "Home", icon: "🏠" },
  { name: "Entertainment", icon: "🎬" },
  { name: "Travel", icon: "✈️" },
  { name: "Other", icon: "📁" },
];

const ICON_BY_NAME = new Map(
  CATEGORIES.map((c) => [c.name.toLowerCase(), c.icon])
);

/** Icon for a category name, with a sensible fallback for custom categories. */
export function iconForCategory(name: string): string {
  return ICON_BY_NAME.get((name ?? "").toLowerCase()) ?? "📁";
}

/** Category label shown when an expense has no category set. */
export const UNCATEGORIZED = "Uncategorized";
