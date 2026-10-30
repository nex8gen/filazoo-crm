import { getWorkspaceViewer } from "@/lib/auth";
import { readQuotation, QuotationError } from "@/lib/data/quotations";
import { renderQuotationPdf } from "@/lib/quotation-pdf";
import { quotationLabel } from "@/lib/quotations";

export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  try {
    const catalog = await readQuotation((await params).id, viewer);
    if (!catalog.quote_document) return Response.json({ error: "Save the quotation before downloading its PDF." }, { status: 409, headers });
    const buffer = await renderQuotationPdf(catalog);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(buffer), { headers: { ...headers, "Content-Type": "application/pdf", "X-Content-Type-Options": "nosniff", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${quotationLabel(catalog)}.pdf"` } });
  } catch (error) { return Response.json({ error: error instanceof QuotationError ? error.message : "Unable to prepare the quotation PDF. Please retry." }, { status: error instanceof QuotationError ? error.status : 503, headers }); }
}
