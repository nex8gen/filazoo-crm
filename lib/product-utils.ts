import type { ProductVariant } from "./types.ts";

const variantTagPrefix = "variant-json:";

export function parseCurrencyAmount(value: string) {
  const amount = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

export function variantsFromTags(tags: string[], fallbackColors: string[], sku: string, price: string, stockStatus: string): ProductVariant[] {
  const encoded = tags.find((tag) => tag.startsWith(variantTagPrefix));
  if (encoded) {
    try {
      const parsed = JSON.parse(decodeURIComponent(encoded.slice(variantTagPrefix.length)));
      if (Array.isArray(parsed)) return parsed.filter(isVariant);
    } catch {
      // Invalid legacy metadata falls back to color-based variants.
    }
  }
  return fallbackColors.map((name, index) => ({ id: `${sku}-${index + 1}`, name, sku: `${sku}-${String(index + 1).padStart(2, "0")}`, price, stockStatus, imageUrl: null }));
}

export function variantTag(variants: ProductVariant[]) {
  return `${variantTagPrefix}${encodeURIComponent(JSON.stringify(variants))}`;
}

function isVariant(value: unknown): value is ProductVariant {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.sku === "string" && typeof item.price === "string" && typeof item.stockStatus === "string" && (typeof item.imageUrl === "string" || item.imageUrl === null);
}
