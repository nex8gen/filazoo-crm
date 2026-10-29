import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ensureCompanyCatalogPdf } from "@/lib/data/catalog-pdfs";
import { companyCatalogPdfFilename } from "@/lib/company-catalog-pdf";
import type { Catalog } from "@/lib/types";

export const maxDuration = 240;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401 });
  if (!["admin", "operator", "bd_manager", "viewer"].includes(viewer.role)) return Response.json({ error: "Catalog access denied." }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid catalog ID." }, { status: 400 });
  try {
    const { data, error } = await createSupabaseAdmin().from("catalogs").select("id,product_skus,currency,price_date,version,pdf_url,created_at,companies(name)").eq("id", id).eq("user_id", viewer.id).maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "Catalog not found." }, { status: 404 });
    const relation = data.companies as unknown as { name: string } | { name: string }[] | null;
    const company = Array.isArray(relation) ? relation[0] : relation;
    const catalog: Catalog = { id: data.id, company: company?.name || "Unknown company", productSkus: data.product_skus ?? [], currency: data.currency, priceDate: data.price_date, version: data.version, pdfUrl: data.pdf_url, createdAt: data.created_at };
    const bytes = await ensureCompanyCatalogPdf(catalog, undefined, viewer.id);
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${companyCatalogPdfFilename(catalog)}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("Catalog PDF failed", id, error);
    return Response.json({ error: "Unable to prepare this catalog PDF. Please retry or check that its products are still available." }, { status: 503 });
  }
}
