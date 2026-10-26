import { z } from "zod";
import { portalError, portalHeaders, portalSession, PortalError } from "@/lib/data/customer-portal";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { invoicePdfFilename } from "@/lib/invoice-pdf-meta";
export const maxDuration = 60;
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new PortalError("Invalid invoice.");
    const { invoice } = await portalSession(id);
    const bytes = await renderInvoicePdf(invoice, new Date().toISOString().slice(0, 10));
    return new Response(new Uint8Array(bytes), { headers: { ...portalHeaders, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${invoicePdfFilename(invoice)}"` } });
  } catch (error) { return portalError(error); }
}
