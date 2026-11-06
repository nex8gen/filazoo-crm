import type { Product } from "../types.ts";
import { validProductImage } from "../product-images.ts";
import { parseEmailSummary, type EmailSummary } from "./email-summary.ts";

export type SummaryCatalog = {
  status: "available" | "unavailable" | "disabled";
  products: Product[];
};

/** Use the same current, personalized records as /products/[sku]. */
export async function loadSummaryCatalog(
  allowed: boolean,
  load: () => Promise<{ mode: string; products: Product[] }>,
): Promise<SummaryCatalog> {
  if (!allowed) return { status: "disabled", products: [] };
  try {
    const result = await load();
    if (result.mode !== "live") return { status: "unavailable", products: [] };
    return { status: "available", products: result.products.filter(product => product.status === "Active") };
  } catch {
    // Catalog failure must not prevent the conversation summary or follow-up.
    return { status: "unavailable", products: [] };
  }
}

export function summaryProductContext(catalog: SummaryCatalog) {
  return {
    status: catalog.status,
    products: catalog.products.map(product => ({
      sku: product.sku,
      title: product.name,
      material: product.material,
      colors: product.colors,
      diameter: product.diameter,
      weight: product.weight,
    })),
  };
}

/** Model-provided display metadata is always replaced with server records. */
export function attachSummaryProducts(output: string, catalog: SummaryCatalog): string {
  const summary = parseEmailSummary(output);
  const bySku = new Map(catalog.status === "available" ? catalog.products.map(product => [product.sku, product] as const) : []);
  const products = [...new Set(summary.productSkus ?? [])].flatMap(sku => {
    const product = bySku.get(sku);
    if (!product || product.status !== "Active") return [];
    return [{ sku: product.sku, title: product.name, imageUrl: product.imageUrl && validProductImage(product.imageUrl) ? product.imageUrl : null }];
  });
  const productMatchStatus: EmailSummary["productMatchStatus"] = catalog.status === "available"
    ? products.length ? "matched" : "no_match"
    : catalog.status;
  return JSON.stringify({ ...summary, productSkus: products.map(product => product.sku), products, productMatchStatus });
}
