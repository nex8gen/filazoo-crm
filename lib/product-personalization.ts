import type { CrmProductRow } from "./product-utils.ts";

export const personalProductFields = ["name", "material", "color", "diameter", "weight", "price", "currency", "moq", "stock_status", "lead_time", "image_url", "tags", "description", "active"] as const;
export type PersonalProductOverride = { product_sku: string; data: Record<string, unknown>; updated_at: string };
export type PersonalProductRow = CrmProductRow & { override_version?: string | null };

/** Never let stored JSON replace identity or ownership fields. */
export function personalizeProductRows<T extends { sku: string }>(rows: T[], overrides: PersonalProductOverride[]): (T & { override_version: string | null })[] {
  const bySku = new Map(overrides.map((row) => [row.product_sku, row]));
  return rows.map((row) => {
    const override = bySku.get(row.sku);
    const changes = override ? Object.fromEntries(personalProductFields.filter((key) => Object.hasOwn(override.data, key)).map((key) => [key, override.data[key]])) : {};
    return { ...row, ...changes, override_version: override?.updated_at ?? null };
  });
}
