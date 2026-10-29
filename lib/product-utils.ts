import type { Product, ProductVariant } from "./types.ts";

export type CrmProductRow = {
  sku: string; name: string; image_url: string | null; material: string | null;
  color: string | null; diameter: string | null; weight: string | null;
  price: number | string | null; currency: string; moq: number | null;
  stock_status: string | null; lead_time: string | null; tags: string[] | null;
  active: boolean; sheet_updated_at: string | null;
  override_version?: string | null;
  description?: string | null;
};

/** Shared by interactive catalog pages and the background automation worker. */
export function crmProduct(row: CrmProductRow): Product {
  const formatPrice = (value: string | number) => new Intl.NumberFormat("en", { style: "currency", currency: row.currency }).format(Number(value));
  const price = row.price == null ? "—" : formatPrice(row.price);
  const priceTiers = (row.tags ?? []).flatMap((tag) => {
    const match = /^price-tier:(\d+):(\d+(?:\.\d+)?)$/.exec(tag);
    return match ? [{ minimumQuantity: Number(match[1]), price: formatPrice(match[2]) }] : [];
  }).sort((a, b) => a.minimumQuantity - b.minimumQuantity);
  const colors = (row.color || "").split(",").map((color) => color.trim()).filter(Boolean);
  const stockStatus = row.stock_status || "Not specified";
  return {
    sku: row.sku, name: row.name, imageUrl: row.image_url, material: row.material || "—",
    color: row.color || "—", colors, diameter: row.diameter || "—", weight: row.weight || "—",
    price, moq: row.moq, priceTiers: priceTiers.length ? priceTiers : row.price == null ? [] : [{ minimumQuantity: row.moq ?? 1, price }],
    stockStatus, leadTime: row.lead_time || "Not specified", status: row.active ? "Active" : "Inactive",
    updatedAt: row.override_version ?? row.sheet_updated_at, overrideVersion: row.override_version ?? null, currency: row.currency,
    variants: variantsFromTags(row.tags ?? [], colors, row.sku, price, stockStatus),
  };
}

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
