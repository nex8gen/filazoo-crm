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
    return { id: variant.id, name: variant.name.trim(), sku: variant.sku.trim(), price: money(inherited ? basePrice : parseCurrencyAmount(variant.price)), stockStatus: variant.stockStatus, imageUrl: variant.imageUrl || null };
  });
}
