import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { buildCatalogPdf, catalogVariantImage, DEFAULT_CATALOG_IMAGE, type CatalogImage, type CatalogOptions } from "./catalog-pdf.ts";
import { catalogImageCrop } from "./catalog-image-layout.ts";
import type { Product } from "./types.ts";
import { privateProductImagePattern, PRODUCT_IMAGE_BUCKET } from "./product-images.ts";

export async function loadCatalogImages(products: Product[]) {
  const urls = [...new Set([DEFAULT_CATALOG_IMAGE, ...products.flatMap(product => [catalogVariantImage(product), ...product.variants.map(variant => catalogVariantImage(product, variant))])])];
  const images = new Map<string, CatalogImage>();
  for (let index = 0; index < urls.length; index += 12) {
    await Promise.all(urls.slice(index, index + 12).map(async url => {
      try {
        let input: Buffer;
        const privateImage = privateProductImagePattern.exec(url);
        if (privateImage) {
          const { createSupabaseAdmin } = await import("./supabase/admin.ts");
          const { data, error } = await createSupabaseAdmin().storage.from(PRODUCT_IMAGE_BUCKET).download(`${privateImage[1]}/${privateImage[2]}`);
          if (error || !data) return;
          input = Buffer.from(await data.arrayBuffer());
          if (input.length > 10_000_000) return;
        } else if (url.startsWith("/") && !url.startsWith("//")) {
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
        const image = sharp(input, { limitInputPixels: 25_000_000 });
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height) return;
        const crop = catalogImageCrop(url, metadata.width, metadata.height);
        const { data, info } = await image.extract(crop).resize(480, 480, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
        images.set(url, { bytes: new Uint8Array(data), width: info.width, height: info.height });
      } catch { /* The renderer uses the default photo when an image is unavailable. */ }
    }));
  }
  return images;
}

/** Shared by every server-side catalog creator, including automated agents. */
export async function buildServerCatalogPdf(products: Product[], options: Omit<CatalogOptions, "images"> = {}) {
  const images = await loadCatalogImages(products);
  return buildCatalogPdf(products, { ...options, images });
}
