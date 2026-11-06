import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checkInvoiceOrigin, invoiceAccess, invoiceError } from "@/lib/invoice-api";
import { getInvoice } from "@/lib/data/invoices";
import { getViewerMailboxes, getViewerMailbox, mailboxHasSmtp } from "@/lib/data/mailboxes";
import { deliverEmail } from "@/lib/data/manual-email-send";
import { reserveEmailSend, updateEmailSend } from "@/lib/data/email-delivery";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { invoicePdfFilename } from "@/lib/invoice-pdf-meta";
import { invoiceSendSchema } from "@/lib/invoice-send";
import { canManageBilling } from "@/lib/invoice-permissions";

export const maxDuration = 240;
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const access = await invoiceAccess("draft");
  if (access.response) return access.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid invoice ID." }, { status: 400 });
  try {
    const [invoice, mailboxes] = await Promise.all([getInvoice(id), getViewerMailboxes(access.viewer.id)]);
    if (!invoice) return Response.json({ error: "Invoice not found." }, { status: 404 });
    return Response.json({ invoice, canIssue: canManageBilling(access.viewer.role),
      mailboxes: mailboxes.filter(mailboxHasSmtp).map(mailbox => ({ id: mailbox.id, email: mailbox.email })) },
    { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return invoiceError(error); }
}

export async function POST(request: Request, context: Context) {
  const originError = checkInvoiceOrigin(request);
  if (originError) return originError;
  const access = await invoiceAccess("draft");
  if (access.response) return access.response;
  const { id } = await context.params;
  const parsed = invoiceSendSchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: "Enter a recipient, sender, subject, and message." }, { status: 400 });
  const input = parsed.data;
  let reserved = false;
  try {
    const invoice = await getInvoice(id);
    if (!invoice) return Response.json({ error: "Invoice not found." }, { status: 404 });
    if (invoice.status !== "issued") return Response.json({ error: "Issue the invoice before sending it." }, { status: 409 });
    const mailbox = await getViewerMailbox(access.viewer.id, input.mailboxId);
    if (!mailboxHasSmtp(mailbox)) return Response.json({ error: "Choose an active sending mailbox in Settings." }, { status: 400 });
    // Reserve the reviewed request before rendering. The hash includes the invoice
    // revision, so repeated clicks share one durable SMTP delivery reservation.
    const message = { requestId: input.requestId, mailboxId: input.mailboxId, to: [input.to], cc: [], bcc: [],
      subject: input.subject, text: input.text, footerIncluded: false, references: [], attachments: [],
      invoiceId: id, invoiceRevision: input.revision };
    const reservation = await reserveEmailSend(access.viewer, message);
    if (!reservation.reserved) {
      if (reservation.operation?.status === "sent" && reservation.operation.result) return Response.json(reservation.operation.result);
      return Response.json({ error: "This email was already submitted. Check Sent before trying again.", deliveryStatus: reservation.operation?.status }, { status: 409 });
    }
    reserved = true;
    if (invoice.revision !== input.revision) throw new Error("This invoice changed. Close this window and review the latest invoice before sending.");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const pdf = await renderInvoicePdf(invoice, today);
    const latest = await getInvoice(id);
    if (!latest || latest.status !== "issued" || latest.revision !== invoice.revision) throw new Error("The invoice changed during PDF preparation. Review it before sending.");
    const response = await deliverEmail(access.viewer, { ...message, attachments: [{ filename: invoicePdfFilename(invoice), contentType: "application/pdf", content: pdf.toString("base64") }] }, true);
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const { data: operation } = await createSupabaseAdmin().from("email_send_operations").select("status").eq("user_id", access.viewer.id).eq("id", input.requestId).maybeSingle().throwOnError();
      if (operation?.status === "preparing") await updateEmailSend(access.viewer.id, input.requestId, "failed", undefined, result.error);
      return Response.json(result, { status: response.status });
    }
    // Delivery is already recorded by deliverEmail. Tracking failures must never
    // turn an accepted email into an invitation to send it again.
    try {
      const db = createSupabaseAdmin();
      const sentAt = result.email?.timestamp || new Date().toISOString();
      const tracking = await db.from("invoices").update({ last_sent_at: sentAt }).eq("id", id);
      const event = await db.from("invoice_events").insert({ invoice_id: id, actor_id: access.viewer.id, action: "send", data: { to: input.to, requestId: input.requestId, revision: invoice.revision } });
      if (tracking.error || event.error) throw new Error("Invoice delivery tracking failed.");
    } catch {
      result.trackingWarning = "Email sent. Refresh Sent to confirm delivery; invoice tracking could not be updated.";
    }
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    if (invoice.document.purchaseOrderId) revalidatePath(`/purchase-orders/${invoice.document.purchaseOrderId}`);
    if (invoice.company_id) revalidatePath(`/companies/${invoice.company_id}`);
    return Response.json(result);
  } catch (error) {
    if (reserved) {
      // Never reset a submitting, uncertain, or completed SMTP attempt.
      await createSupabaseAdmin().from("email_send_operations").update({ status: "failed", error: error instanceof Error ? error.message : "Unable to prepare invoice email." })
        .eq("user_id", access.viewer.id).eq("id", input.requestId).eq("status", "preparing");
    }
    return invoiceError(error instanceof Error ? { code: "P0001", message: error.message } : error);
  }
}
