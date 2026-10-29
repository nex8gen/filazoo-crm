import { personalizeProductRows } from "../../lib/product-personalization.ts";
import type { PersonalProductOverride } from "../../lib/product-personalization.ts";

/** In-memory service boundary for agent tests; the real DAL is tested separately. */
export function personalProductService(tables: Record<string, Record<string, unknown>[]>) {
  return {
    withPersonalProducts: async (rows: { sku: string }[], userId: string) => personalizeProductRows(rows, (tables.user_product_overrides ?? []).filter((row) => row.user_id === userId) as unknown as PersonalProductOverride[]),
    userProductRows: async (userId: string, skus?: string[]) => {
      const rows = (tables.products ?? []) as Array<{ sku: string }>;
      if (rows.length > 5000) throw new Error("Catalog scan limit reached.");
      return personalizeProductRows(skus ? rows.filter((row) => skus.includes(row.sku)) : rows, (tables.user_product_overrides ?? []).filter((row) => row.user_id === userId) as unknown as PersonalProductOverride[]);
    },
  };
}
