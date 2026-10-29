import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { listProducts } from "./crm.ts";
import { companyCatalogPdfUrl, renderCompanyCatalogPdf } from "../company-catalog-pdf.ts";
import { loadCatalogImages } from "../catalog-pdf-server.ts";
import { getOrCreateCatalogPdf } from "../catalog-pdf-storage.ts";
import type { Catalog, Product } from "../types.ts";
import { requireWorkspaceMember } from "../auth.ts";

/** Caller must authorize workspace membership before using this service. */
export async function ensureCompanyCatalogPdf(catalog: Catalog, preparedProducts?: Product[], authorizedUserId?: string) {
  const admin = createSupabaseAdmin();
  const userId = authorizedUserId ?? (await requireWorkspaceMember()).id;
  const { data: saved, error: readError } = await admin.from("catalogs").select("user_id,product_snapshot").eq("id", catalog.id).eq("user_id", userId).maybeSingle();
  if (readError || !saved) throw new Error("Catalog not found in your account.");
  const bytes = await getOrCreateCatalogPdf(admin.storage, `${userId}/${catalog.id}/v${catalog.version}.pdf`, async () => {
    const { products } = Array.isArray(saved.product_snapshot) ? { products: saved.product_snapshot as Product[] } : preparedProducts !== undefined
      ? { products: preparedProducts.filter(product => catalog.productSkus.includes(product.sku)) }
      : catalog.productSkus.length ? await listProducts(catalog.productSkus) : { products: [] };
    return renderCompanyCatalogPdf(catalog, products, await loadCatalogImages(products));
  });
  if (!catalog.pdfUrl) {
    const { error } = await admin.from("catalogs").update({ pdf_url: companyCatalogPdfUrl(catalog.id) }).eq("id", catalog.id).is("pdf_url", null);
    if (error) throw new Error("The PDF was saved but its catalog link could not be updated. Please retry.");
  }
  return bytes;
}

export async function prepareCompanyCatalogPdfs(catalogs: Catalog[], preparedProducts?: Product[], authorizedUserId?: string) {
  const missing = catalogs.filter(catalog => !catalog.pdfUrl);
  for (let index = 0; index < missing.length; index += 4) {
    await Promise.all(missing.slice(index, index + 4).map(async catalog => {
      try {
        await ensureCompanyCatalogPdf(catalog, preparedProducts, authorizedUserId);
        catalog.pdfUrl = companyCatalogPdfUrl(catalog.id);
      } catch (error) {
        // Keep the list usable; the PDF action can retry and report the error.
        console.error("Catalog PDF preparation failed", catalog.id, error);
      }
    }));
  }
}
