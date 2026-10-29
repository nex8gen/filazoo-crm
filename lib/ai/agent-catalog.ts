import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { preparedAgentEmailSchema } from "./agent-actions";
import type { agentEmailSchema } from "./workspace-assistant";

type Email = z.infer<typeof agentEmailSchema>;
type PreparedEmail = z.infer<typeof preparedAgentEmailSchema>;

async function currentCatalog() {
  const { listProducts } = await import("../data/crm");
  const { mode, products } = await listProducts(undefined, { requireComplete: true });
  // listProducts is bounded at 500. Never label a truncated read a full catalog.
  if (mode === "demo" || products.length >= 500) throw new Error("Unable to load the complete catalog. Choose and attach products in the inbox catalog picker.");
  const active = products.filter((product) => product.status === "Active").sort((a, b) => a.sku.localeCompare(b.sku));
  if (!active.length) throw new Error("No active products are available for the catalog PDF.");
  const fingerprint = createHash("sha256").update(JSON.stringify(active.map((product) => ({
    sku: product.sku, name: product.name, imageUrl: product.imageUrl, material: product.material,
    color: product.color, colors: product.colors, diameter: product.diameter, weight: product.weight,
    price: product.price, moq: product.moq, priceTiers: product.priceTiers, variants: product.variants,
    currency: product.currency, stockStatus: product.stockStatus, leadTime: product.leadTime,
  })))).digest("hex");
  return { products: active, snapshot: { productSkus: active.map((product) => product.sku), fingerprint } };
}

export async function prepareAgentCatalog<T extends Email>(email: T) {
  if (!email.attachCatalog) {
    if (/\battach(?:ed|ing)?\b[^.!?\n]{0,80}\bcatalog(?:ue)?\b|\bcatalog(?:ue)?\b[^.!?\n]{0,80}\battach(?:ed|ing)?\b/i.test(email.text)) {
      throw new Error("The email says a catalog is attached, but no catalog PDF was requested by the agent. Ask it to prepare the email with the catalog PDF again.");
    }
    return email;
  }
  return { ...email, catalogSnapshot: (await currentCatalog()).snapshot };
}

/** Recheck approved product/pricing data before generating any attachment. */
export async function agentCatalogAttachments(email: PreparedEmail) {
  if (!email.attachCatalog) return [];
  const current = await currentCatalog();
  if (!email.catalogSnapshot || JSON.stringify(current.snapshot) !== JSON.stringify(email.catalogSnapshot)) {
    throw new Error("The catalog changed after approval. Ask the agent to prepare a fresh email with the current catalog PDF.");
  }
  const { buildServerCatalogPdf } = await import("../catalog-pdf-server");
  const bytes = Buffer.from(await buildServerCatalogPdf(current.products, { title: "Filazoo product catalog" }));
  if (bytes.subarray(0, 5).toString() !== "%PDF-" || bytes.length > 7_500_000) {
    throw new Error("The catalog PDF could not be attached or exceeds 7.5 MB. Choose products in the inbox catalog picker.");
  }
  return [{ filename: "Filazoo-product-catalog.pdf", contentType: "application/pdf", content: bytes.toString("base64"), size: bytes.length }];
}
