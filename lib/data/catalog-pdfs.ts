import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { listProducts } from "./crm.ts";
import { companyCatalogPdfUrl, renderCompanyCatalogPdf } from "../company-catalog-pdf.ts";
import { catalogVariantImage, DEFAULT_CATALOG_IMAGE, type CatalogImage } from "../catalog-pdf.ts";
import { getOrCreateCatalogPdf } from "../catalog-pdf-storage.ts";
import type { Catalog, Product } from "../types.ts";

async function catalogImages(products: Product[]) {
  const urls = [...new Set([DEFAULT_CATALOG_IMAGE, ...products.flatMap(product => [catalogVariantImage(product), ...product.variants.map(variant => catalogVariantImage(product, variant))])])];
  const images = new Map<string, CatalogImage>();
  for (let index = 0; index < urls.length; index += 6) {
    await Promise.all(urls.slice(index, index + 6).map(async url => {
      try {
        let input: Buffer;
        if (url.startsWith("/") && !url.startsWith("//")) {
          const root = path.resolve(process.cwd(), "public");
          const file = path.resolve(root, `.${url}`);
          if (!file.startsWith(root + path.sep)) return;
          input = await readFile(file);
        } else {
          const remote = new URL(url);
          // Only trusted image hosts; never fetch arbitrary CRM URLs from the server.
          const storageHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : "";
          if (remote.protocol !== "https:" || !["cdn.shopify.com", storageHost].includes(remote.hostname)) return;
          const response = await fetch(remote, { redirect: "error", signal: AbortSignal.timeout(5000) });
          if (!response.ok || Number(response.headers.get("content-length")) > 10_000_000) return;
          input = Buffer.from(await response.arrayBuffer());
          if (input.length > 10_000_000) return;
        }
        const { data, info } = await sharp(input, { limitInputPixels: 25_000_000 }).resize(480, 480, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
        images.set(url, { bytes: new Uint8Array(data), width: info.width, height: info.height });
      } catch { /* The renderer uses the default photo when an image is unavailable. */ }
    }));
  }
  return images;
}

/** Caller must authorize workspace membership before using this service. */
export async function ensureCompanyCatalogPdf(catalog: Catalog) {
  const admin = createSupabaseAdmin();
  const bytes = await getOrCreateCatalogPdf(admin.storage, `${catalog.id}/v${catalog.version}.pdf`, async () => {
    const { products } = catalog.productSkus.length ? await listProducts(catalog.productSkus) : { products: [] };
    return renderCompanyCatalogPdf(catalog, products, await catalogImages(products));
  });
  if (!catalog.pdfUrl) {
    const { error } = await admin.from("catalogs").update({ pdf_url: companyCatalogPdfUrl(catalog.id) }).eq("id", catalog.id).is("pdf_url", null);
    if (error) throw new Error("The PDF was saved but its catalog link could not be updated. Please retry.");
  }
  return bytes;
}

export async function prepareCompanyCatalogPdfs(catalogs: Catalog[]) {
  const missing = catalogs.filter(catalog => !catalog.pdfUrl);
  for (let index = 0; index < missing.length; index += 4) {
    await Promise.all(missing.slice(index, index + 4).map(async catalog => {
      try {
        await ensureCompanyCatalogPdf(catalog);
        catalog.pdfUrl = companyCatalogPdfUrl(catalog.id);
      } catch (error) {
        // Keep the list usable; the PDF action can retry and report the error.
        console.error("Catalog PDF preparation failed", catalog.id, error);
      }
    }));
  }
}
