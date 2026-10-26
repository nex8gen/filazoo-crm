import type { SupabaseClient } from "@supabase/supabase-js";

export const CATALOG_PDF_BUCKET = "company-catalog-pdfs";

/** Immutable version files: concurrent generators must return the same winning file. */
export async function getOrCreateCatalogPdf(
  storage: SupabaseClient["storage"],
  path: string,
  render: () => Promise<Uint8Array>,
) {
  const bucket = storage.from(CATALOG_PDF_BUCKET);
  const existing = await bucket.download(path);
  if (existing.data) return new Uint8Array(await existing.data.arrayBuffer());
  // Never mistake an outage or denied access for a missing version.
  const readError = existing.error as { statusCode?: string; message?: string } | null;
  if (!(String(readError?.statusCode) === "404" || (String(readError?.statusCode) === "400" && /not found/i.test(readError?.message ?? "")))) {
    throw new Error("Unable to read the saved catalog PDF. Please retry.");
  }
  const bytes = await render();
  const created = await storage.createBucket(CATALOG_PDF_BUCKET, {
    public: false, allowedMimeTypes: ["application/pdf"], fileSizeLimit: 20 * 1024 * 1024,
  });
  if (created.error && !/already exists|duplicate/i.test(created.error.message)) {
    throw new Error("Unable to prepare private catalog PDF storage.");
  }
  const uploaded = await bucket.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (!uploaded.error) return bytes;
  // A competing request may have saved this version while we rendered it.
  const winner = await bucket.download(path);
  if (winner.data) return new Uint8Array(await winner.data.arrayBuffer());
  throw new Error("Unable to save the catalog PDF. Please retry.");
}
