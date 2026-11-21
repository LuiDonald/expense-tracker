// THE single list of expense categories, shared by:
//   - the app (src/data/categories.ts re-exports it: chips, icons)
//   - parse-receipt (tells the AI which categories it may choose)
//   - agent-api (normalizes the category Muse sends)
//
// Edit names/icons here only. Keep this file free of imports so it runs both in
// the app (Metro) and in Supabase Edge Functions (Deno).
//
// After editing: redeploy the web app AND both functions, or they'll disagree:
//   npm run deploy:web
//   npx supabase functions deploy parse-receipt agent-api --remote=<ref> --no-verify-jwt --use-api
//
// Categories not in this list still work (the agent can set a custom one, and
// old expenses keep theirs); they just show the 📁 icon.

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

export const CATEGORY_NAMES: string[] = CATEGORIES.map((c) => c.name);

/** The canonical spelling of `raw` if it matches a known category (any case), else null. */
export function canonicalCategory(raw: string): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  return CATEGORY_NAMES.find((n) => n.toLowerCase() === t) ?? null;
}
