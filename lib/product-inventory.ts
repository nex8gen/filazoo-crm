import type { Product, ProductStock } from "./types.ts";

export type StockSnapshot = { sku: string; available: number; on_hand: number; locked: number; warehouse_ids: string[]; synced_at: string };

export function stockLabel(stock: ProductStock | null | undefined, now = Date.now()) {
  if (!stock) return "Stock unknown";
  const stale = now - new Date(stock.syncedAt).getTime() > 30 * 60_000;
  return `${stock.available.toLocaleString("en")} available${stale ? " · stale" : ""}`;
}

export function applyProductInventory(products: Product[], snapshots: StockSnapshot[], skuMap: Record<string, string> = {}): Product[] {
  const bySku = new Map(snapshots.map(row => [row.sku, row]));
  const stockFor = (sku: string): ProductStock | null => {
    const row = bySku.get(skuMap[sku] ?? sku);
    return row ? { available: row.available, onHand: row.on_hand, locked: row.locked, warehouseIds: row.warehouse_ids, syncedAt: row.synced_at } : null;
  };
  return products.map(product => {
    const variants = product.variants.map(variant => { const stock = stockFor(variant.sku); return { ...variant, stock, stockStatus: stockLabel(stock) }; });
    let stock = stockFor(product.sku);
    // A family total is valid only when every variant is matched. Count each
    // ERP SKU once if multiple CRM aliases point at the same stock item.
    if (!stock && variants.length && variants.every(variant => variant.stock)) {
      const unique = [...new Map(variants.map(variant => [skuMap[variant.sku] ?? variant.sku, variant.stock!])).values()];
      stock = { available: 0, onHand: 0, locked: 0, warehouseIds: [], syncedAt: unique[0].syncedAt };
      for (const item of unique) {
        stock.available += item.available; stock.onHand += item.onHand; stock.locked += item.locked;
        stock.warehouseIds = [...new Set([...stock.warehouseIds, ...item.warehouseIds])];
        if (item.syncedAt < stock.syncedAt) stock.syncedAt = item.syncedAt;
      }
    }
    return { ...product, stock, stockStatus: stockLabel(stock), variants };
  });
}
