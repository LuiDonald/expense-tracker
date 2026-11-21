// The category list lives in ONE place, shared with the Supabase functions:
// supabase/functions/_shared/categories.ts. Edit it there, not here.
import { CATEGORIES } from "../../supabase/functions/_shared/categories";

export type { Category } from "../../supabase/functions/_shared/categories";
export { CATEGORIES };

const ICON_BY_NAME = new Map(
  CATEGORIES.map((c) => [c.name.toLowerCase(), c.icon])
);

/** Icon for a category name, with a sensible fallback for custom categories. */
export function iconForCategory(name: string): string {
  return ICON_BY_NAME.get((name ?? "").toLowerCase()) ?? "📁";
}

/** Category label shown when an expense has no category set. */
export const UNCATEGORIZED = "Uncategorized";
