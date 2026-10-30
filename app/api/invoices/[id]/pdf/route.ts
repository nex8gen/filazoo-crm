import { z } from "zod";
import { invoiceAccess, invoiceError } from "@/lib/invoice-api";
import { getInvoice } from "@/lib/data/invoices";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { invoicePdfFilename } from "@/lib/invoice-pdf-meta";

export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await invoiceAccess();
  if (access.response) return access.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid invoice ID." }, { status: 400 });
  try {
    const invoice = await getInvoice(id);
    if (!invoice) return Response.json({ error: "Invoice not found." }, { status: 404 });
    const bytes = await renderInvoicePdf(invoice, new Date().toISOString().slice(0, 10));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `${new URL(request.url).searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="${invoicePdfFilename(invoice)}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Invoice-Revision": String(invoice.revision),
      "X-Invoice-Filename": invoicePdfFilename(invoice),
    } });
  } catch (error) { return invoiceError(error); }
}
