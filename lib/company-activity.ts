import type { CompanyActivity } from "./types.ts";
import { normalizeMessageId } from "./email-threading.ts";

export type ActivityInvoice = {
  id: string; number: number; status: string; total_minor: number; paid_minor: number;
  created_by: string | null; created_at: string;
  document: { currency: string; customerName: string; customerEmail: string; issueDate: string; dueDate: string; reference: string };
};
export type ActivityPayment = {
  id: string; invoice_id: string; amount_minor: number; paid_on: string;
  method: string; reference: string; created_by: string | null; created_at: string;
};
export type ActivityInvoiceEvent = {
  id: number; invoice_id: string; action: string; actor_id: string | null; created_at: string;
};
export type ActivitySentMail = {
  id: string; user_id: string; from_email: string; to_email: string; subject: string;
  body: string; status: string; sent_at: string; message_id: string | null;
  attachments: { filename?: string }[] | null;
};

export function billingActivity(invoices: ActivityInvoice[], payments: ActivityPayment[], events: ActivityInvoiceEvent[], names: Map<string, string>): CompanyActivity[] {
  const actor = (id: string | null) => id ? names.get(id) || "Workspace member" : "System";
  return invoices.flatMap((invoice) => {
    const number = `INV-${String(invoice.number).padStart(6, "0")}`;
    const money = (minor: number) => new Intl.NumberFormat("en", { style: "currency", currency: invoice.document.currency }).format(minor / 100);
    const metadata = [
      { label: "Invoice", value: number },
      { label: "Customer", value: invoice.document.customerName },
      { label: "Total", value: money(invoice.total_minor) },
      { label: "Paid to date", value: money(invoice.paid_minor) },
      { label: "Outstanding now", value: money(invoice.total_minor - invoice.paid_minor) },
      { label: "Current status", value: invoice.status },
      { label: "Issue date", value: invoice.document.issueDate },
      { label: "Due date", value: invoice.document.dueDate },
      ...(invoice.document.reference ? [{ label: "Reference", value: invoice.document.reference }] : []),
    ];
    const base = { type: "invoice" as const, href: `/invoices/${invoice.id}`, metadata };
    return [
      { ...base, id: `invoice-${invoice.id}`, title: "Invoice created", detail: `${number} · ${money(invoice.total_minor)}`, actor: actor(invoice.created_by), actorId: invoice.created_by, createdAt: invoice.created_at },
      ...events.filter((event) => event.invoice_id === invoice.id && event.action !== "payment").map((event) => ({
        ...base, id: `invoice-event-${event.id}`,
        title: ({ issue: "Invoice issued", save: "Invoice updated", void: "Invoice voided" } as Record<string, string>)[event.action] || `Invoice ${event.action.replaceAll("_", " ")}`,
        detail: number, actor: actor(event.actor_id), actorId: event.actor_id, createdAt: event.created_at,
      })),
      ...payments.filter((payment) => payment.invoice_id === invoice.id).map((payment) => ({
        ...base, type: "payment" as const, id: `payment-${payment.id}`, title: "Payment recorded",
        detail: `${money(payment.amount_minor)} via ${payment.method.replaceAll("_", " ")} · ${number}`,
        actor: actor(payment.created_by), actorId: payment.created_by, createdAt: payment.created_at,
        metadata: [
          { label: "Payment amount", value: money(payment.amount_minor) },
          { label: "Payment date", value: payment.paid_on },
          { label: "Method", value: payment.method.replaceAll("_", " ") },
          { label: "Payment reference", value: payment.reference || "No reference" },
          { label: "Payment ID", value: payment.id },
          ...metadata,
        ],
      })),
    ];
  });
}

export function sentMailActivity(messages: ActivitySentMail[], names: Map<string, string>): CompanyActivity[] {
  return messages.map((mail) => ({
    id: `mailbox-${mail.id}`, type: "email", title: mail.status === "failed" ? "Email failed" : "Email sent",
    detail: `${mail.subject || "Untitled email"} · ${mail.to_email}`, body: mail.body,
    direction: "sent", actor: names.get(mail.user_id) || mail.from_email, actorId: mail.user_id,
    createdAt: mail.sent_at, messageId: mail.message_id,
    metadata: [
      { label: "From", value: mail.from_email }, { label: "To", value: mail.to_email },
      { label: "Subject", value: mail.subject || "Untitled email" }, { label: "Status", value: mail.status },
      ...(mail.message_id ? [{ label: "Message ID", value: mail.message_id }] : []),
      ...(mail.attachments ?? []).flatMap((file) => file.filename ? [{ label: "Attachment", value: file.filename }] : []),
    ],
  }));
}

// Prefer the mailbox copy (with full sender and recipient details) when sync
// has also imported that same message into CRM emails. Never merge by subject.
export function mergeCompanyActivity(items: CompanyActivity[]): CompanyActivity[] {
  const seen = new Set<string>();
  return [...items].sort((a, b) => Number(b.id.startsWith("mailbox-")) - Number(a.id.startsWith("mailbox-")))
    .filter((item) => {
      const message = item.type === "email" ? normalizeMessageId(item.messageId) : null;
      const key = message ? `email:${item.direction}:${message}` : item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}
