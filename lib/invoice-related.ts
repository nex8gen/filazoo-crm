import type { Invoice } from "./invoices.ts";

export function relatedInvoiceOrder(groups: Invoice[][], threadId?: string) {
  const unique = new Map<string, Invoice>();
  for (const group of groups) for (const invoice of group) unique.set(invoice.id, invoice);
  const inConversation = (invoice: Invoice) => !!threadId &&
    (invoice.source_thread_id === threadId || invoice.document.sourceThreadId === threadId);
  return [...unique.values()].sort((a, b) =>
    Number(inConversation(b)) - Number(inConversation(a)) ||
    b.created_at.localeCompare(a.created_at) || b.number - a.number,
  ).slice(0, 50);
}

export function literalInvoiceEmail(email: string) {
  return email.trim().toLowerCase().replace(/[%_\\]/g, "\\$&");
}
