import type { ProductVariant } from "./types.ts";
import { parseCurrencyAmount } from "./product-utils.ts";

export function validVariantPrice(value: string) {
  const numeric = value.replace(/(?:USD|EUR|GBP|CNY|CN)|[$€£¥￥,\s]/g, "");
  return /^\d+(?:\.\d{1,2})?$/.test(numeric) && Number(numeric) <= 1_000_000;
}

/** Variants using the old base price follow a base edit; explicit overrides stay. */
export function normalizeProductVariants(variants: ProductVariant[], currency: string, basePrice: number, previous?: { price: number | string | null; variants: ProductVariant[] }) {
  const money = (value: number) => new Intl.NumberFormat("en", { style: "currency", currency }).format(value);
  return variants.map((variant) => {
    const before = previous?.variants.find((item) => item.id === variant.id);
    const inherited = previous?.price != null && before && parseCurrencyAmount(before.price) === Number(previous.price) && parseCurrencyAmount(variant.price) === parseCurrencyAmount(before.price);
    const stockStatus = variant.manualInventory === null ? "Stock unknown" : variant.manualInventory !== undefined ? `${variant.manualInventory.toLocaleString("en")} available` : variant.stockStatus;
    return { id: variant.id, name: variant.name.trim(), sku: variant.sku.trim(), price: money(inherited ? basePrice : parseCurrencyAmount(variant.price)), stockStatus, imageUrl: variant.imageUrl || null,
      ...(variant.manualInventory === undefined ? {} : { manualInventory: variant.manualInventory }),
      ...(variant.colorHex === undefined ? {} : { colorHex: variant.colorHex }),
      ...(variant.options === undefined ? {} : { options: variant.options.map(option => ({ name: option.name.trim(), value: option.value.trim() })) }),
      ...(variant.barcode === undefined ? {} : { barcode: variant.barcode?.trim() || null }),
      ...(variant.compareAtPrice === undefined ? {} : { compareAtPrice: variant.compareAtPrice ? money(parseCurrencyAmount(variant.compareAtPrice)) : null }),
      ...(variant.costPerItem === undefined ? {} : { costPerItem: variant.costPerItem ? money(parseCurrencyAmount(variant.costPerItem)) : null }),
      ...(variant.unitPricing === undefined ? {} : { unitPricing: variant.unitPricing }),
    };
  });
}
