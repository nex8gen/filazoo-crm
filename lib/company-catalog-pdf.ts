import type { Catalog, Product } from "./types.ts";
import { buildCatalogPdf, type CatalogImage } from "./catalog-pdf.ts";

export function companyCatalogPdfUrl(id: string, download = false) {
  return `/api/catalogs/${encodeURIComponent(id)}/pdf${download ? "?download=1" : ""}`;
}

export function companyCatalogPdfFilename(catalog: Pick<Catalog, "company" | "version">) {
  const name = catalog.company.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "company";
  return `filazoo-${name}-catalog-v${catalog.version}.pdf`;
}

export function renderCompanyCatalogPdf(catalog: Catalog, products: Product[], images?: Map<string, CatalogImage>) {
  const bySku = new Map(products.map(product => [product.sku, product]));
  const selected = catalog.productSkus.map(sku => {
    const product = bySku.get(sku);
    if (!product) throw new Error(`Product ${sku} is unavailable. Restore it before generating this catalog PDF.`);
    return product;
  });
  return buildCatalogPdf(selected, {
    title: `Product catalog v${catalog.version}`,
    customer: catalog.company,
    date: catalog.priceDate.slice(0, 10),
    images,
  });
}
