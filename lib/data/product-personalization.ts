import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { personalizeProductRows, type PersonalProductOverride, type PersonalProductRow } from "../product-personalization.ts";

export const personalProductSelect = "sku,name,image_url,material,color,diameter,weight,price,currency,moq,stock_status,lead_time,tags,description,active,sheet_updated_at";

/** Explicit owner is required by request handlers and request-independent workers. */
export async function withPersonalProducts<T extends { sku: string }>(rows: T[], userId: string) {
  if (!userId) throw new Error("A product owner is required.");
  const overrides: PersonalProductOverride[] = [];
  for (let start = 0; start < rows.length; start += 400) {
    const { data, error } = await createSupabaseAdmin().from("user_product_overrides").select("product_sku,data,updated_at")
      .eq("user_id", userId).in("product_sku", rows.slice(start, start + 400).map((row) => row.sku));
    if (error) throw new Error("Unable to load your saved product details. Please retry.");
    overrides.push(...(data ?? []));
  }
  return personalizeProductRows(rows, overrides);
}

export async function userProductRows(userId: string, skus?: string[]): Promise<PersonalProductRow[]> {
  if (!userId) throw new Error("A product owner is required.");
  if (skus && !skus.length) return [];
  const rows: PersonalProductRow[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = createSupabaseAdmin().from("products").select(personalProductSelect).order("sku").range(offset, offset + 499);
    if (skus) query = query.in("sku", skus);
    const { data, error } = await query;
    if (error) throw new Error("Unable to load product details.");
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) break;
    if (offset >= 4500) throw new Error("Narrow the product selection; the catalog lookup limit was reached.");
  }
  return (await withPersonalProducts(rows, userId)).filter((row) => !row.sku.startsWith("SAMPLE-") && !row.name.toLowerCase().startsWith("[sample]"));
}
