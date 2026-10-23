import { invoiceLabel, type Invoice } from "./invoices.ts";

export function invoicePdfFilename(invoice: Pick<Invoice, "number" | "status">) {
  return `${invoiceLabel(invoice)}${invoice.status === "draft" ? "-DRAFT" : invoice.status === "void" ? "-VOID" : ""}.pdf`;
}

export type InvoiceAttachment = { id: string; filename: string; content: string; contentType: string; size: number };

export function mergeInvoiceAttachment<T extends InvoiceAttachment>(current: T[], attachment: T) {
  if (attachment.size > 7_500_000) throw new Error("The invoice PDF exceeds the 7.5 MB attachment limit.");
  const withoutOldVersion = current.filter((item) => item.id !== attachment.id);
  if (withoutOldVersion.length >= 10) throw new Error("You can attach up to 10 files to one email.");
  return [...withoutOldVersion, attachment];
}
