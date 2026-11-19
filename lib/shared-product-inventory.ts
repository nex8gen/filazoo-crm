import type { Product, SharedManualStock } from "./types.ts";

export function manualStockTotal(stock: SharedManualStock) {
  if (!stock.locations.length || stock.locations.some(row => row.quantity == null)) return null;
  const total = stock.locations.reduce((sum, row) => sum + row.quantity!, 0);
  return Number.isSafeInteger(total) ? total : null;
}

/** Never silently promote conflicting personal quantities into team inventory. */
export function applySharedManualStock(products: Product[], rows: ({ sku: string } & SharedManualStock["locations"][number])[]): Product[] {
  const bySku = new Map<string, SharedManualStock["locations"]>();
  for (const row of rows) bySku.set(row.sku, [...(bySku.get(row.sku) ?? []), row]);
  const shared = (sku: string, legacyQuantity: number | null | undefined): SharedManualStock => ({ locations: bySku.get(sku) ?? [], legacyQuantity });
  return products.map(product => {
    const sharedInventory = shared(product.sku, product.manualInventory);
    return { ...product, sharedInventory, manualInventory: manualStockTotal(sharedInventory), stockStatus: "Stock unknown", variants: product.variants.map(variant => {
      const sharedInventory = shared(variant.sku, variant.manualInventory);
      return { ...variant, sharedInventory, manualInventory: manualStockTotal(sharedInventory), stockStatus: "Stock unknown" };
    }) };
  });
}
