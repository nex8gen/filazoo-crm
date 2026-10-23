import { replyInvoiceLines, type EmailReplyPlan } from "./ai/email-reply.ts";
import { invoiceDocumentSchema, type InvoiceDocument } from "./invoices.ts";
import type { InvoiceProduct } from "./invoice-links.ts";

export async function prepareReplyInvoice({ items, email, companyId, threadId, sourceMessageId, customerName, cache, isCurrent, request = fetch }: {
  items: EmailReplyPlan["invoiceItems"];
  email: string;
  companyId?: string | null;
  threadId?: string;
  sourceMessageId?: string;
  customerName: string;
  cache: Map<string, string>;
  isCurrent: () => boolean;
  request?: typeof fetch;
}) {
  const checkCurrent = () => { if (!isCurrent()) throw new Error("The conversation changed. Generate the reply again in the intended conversation."); };
  async function json(url: string, init?: RequestInit) {
    checkCurrent();
    const response = await request(url, { cache: "no-store", ...init });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to prepare the draft invoice.");
    checkCurrent();
    return result;
  }
  const key = JSON.stringify({ email, companyId, threadId, sourceMessageId, items: [...items].sort((a, b) => `${a.productSku}:${a.variantId}:${a.quantity}`.localeCompare(`${b.productSku}:${b.variantId}:${b.quantity}`)) });
  let id = cache.get(key);
  if (id) {
    const saved = await json(`/api/invoices/${id}`);
    if (saved.invoice?.status !== "draft") throw new Error("This invoice is no longer a draft. Review it in Invoices before replying.");
  }
  if (!id) {
    const params = new URLSearchParams({ email, ...(companyId ? { companyId } : {}), ...(threadId ? { threadId } : {}) });
    const context = await json(`/api/invoices/context?${params}`) as { document: InvoiceDocument };
    const skus = [...new Set(items.map((item) => item.productSku))];
    const selection = await json(`/api/invoices/context?${new URLSearchParams({ kind: "products", skus: JSON.stringify(skus) })}`) as { products: InvoiceProduct[] };
    const { lines, currency } = replyInvoiceLines(items, selection.products);
    const document = invoiceDocumentSchema.parse({
      ...context.document,
      customerName: context.document.customerName || customerName || email,
      customerEmail: email,
      currency,
      items: lines,
      notes: [context.document.notes, "Draft for customer review. Shipping and applicable taxes must be confirmed before issue."].filter(Boolean).join("\n"),
    });
    checkCurrent();
    // Keep the saved ID even if PDF preparation fails, so a retry uses the same draft.
    const response = await request("/api/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(document) });
    const result = await response.json();
    if (!response.ok || !result.invoice?.id) throw new Error(result.error || "Unable to save the draft invoice.");
    id = result.invoice.id as string;
    cache.set(key, id);
  }
  checkCurrent();
  const response = await request(`/api/invoices/${id}/pdf`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Draft invoice saved. Open it in Invoices or retry to attach its PDF.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  checkCurrent();
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-" || bytes.byteLength > 7_500_000)
    throw new Error("Draft invoice saved, but its PDF is invalid or exceeds 7.5 MB. Review it in Invoices.");
  return { id: `invoice-${id}`, filename: response.headers.get("X-Invoice-Filename") || `draft-invoice-${id}.pdf`, bytes, invoiceId: id };
}
