import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { applySharedManualStock } from "../shared-product-inventory.ts";
import type { ManualStockLocation, Product } from "../types.ts";

export async function readManualStock(skus: string[]) {
  const viewer = await requireWorkspaceMember();
  const client = createSupabaseAdmin();
  const rows: (ManualStockLocation & { sku: string })[] = [];
  const unique = [...new Set(skus)];
  if (!unique.length) return rows;
  const wanted = new Set(unique);
  // A catalog may contain thousands of variant SKUs. Read the workspace's
  // actual stock rows once instead of issuing a query per variant batch.
  for (let offset = 0; ; offset += 1000) {
    let query = client.from("product_manual_stock").select("sku,location,quantity,revision,updated_at").eq("workspace_id", viewer.workspaceId).order("sku").order("location").range(offset, offset + 999);
    if (unique.length <= 200) query = query.in("sku", unique);
    const { data, error } = await query;
    if (error) throw new Error("Unable to load shared inventory. Please retry.");
    rows.push(...(data ?? []).filter(row => wanted.has(row.sku)));
    if ((data?.length ?? 0) < 1000) break;
  }
  return rows;
}

export async function withSharedManualStock(products: Product[]) {
  const viewer = await requireWorkspaceMember();
  return applySharedManualStock(products, await readManualStock(products.flatMap(product => [product.sku, ...product.variants.map(variant => variant.sku)]))).map(product => ({ ...product, sharedInventory: { ...product.sharedInventory!, readOnly: viewer.role === "viewer" }, variants: product.variants.map(variant => ({ ...variant, sharedInventory: { ...variant.sharedInventory!, readOnly: viewer.role === "viewer" } })) }));
}
