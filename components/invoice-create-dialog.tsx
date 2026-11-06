"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { invoiceContextUrl, invoiceRequest } from "@/lib/invoice-client";
import { formatMoney, invoiceLabel, invoiceStatus, type Invoice } from "@/lib/invoices";
import { orderInvoiceHref } from "@/lib/order-invoice-links";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type InvoiceEmailContext = { companyId?: string | null; email: string; threadId?: string; customerName?: string; target?: "reply" | "compose" };

/** Email attaches an existing order document. Creation and editing happen on the PO. */
export function InvoiceCreateDialog({ context, onClose, onAttach }: {
  context: InvoiceEmailContext; invoiceViewer?: { id: string; role: string }; onClose: () => void; onAttach: (invoiceId: string) => Promise<void>;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    invoiceRequest(invoiceContextUrl(context), undefined, undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) { setInvoices(data.invoices ?? []); setLoading(false); }
    }).catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Unable to load invoices."); setLoading(false); } });
    return () => controller.abort();
  }, [context]);
  async function attach(id: string) {
    setBusy(id); setError("");
    try { await onAttach(id); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to attach the invoice PDF."); }
    finally { setBusy(null); }
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>Attach order invoice</DialogTitle><DialogDescription>Invoices are generated with purchase orders. Choose an order invoice to attach.</DialogDescription></DialogHeader>
    {loading ? <p role="status">Loading invoices…</p> : <div className="space-y-3">{invoices.map(invoice => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><p className="text-sm font-medium">{invoiceLabel(invoice)} · {invoice.document.customerName}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{invoiceStatus(invoice, today)} · {formatMoney(invoice.total_minor, invoice.document.currency)}</p></div><div className="flex gap-2"><Button disabled={Boolean(busy) || invoice.status === "void"} onClick={() => void attach(invoice.id)}>{busy === invoice.id ? "Preparing PDF…" : "Attach PDF"}</Button><Link href={orderInvoiceHref(invoice)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>Open order</Link></div></div>)}{!invoices.length ? <p className="text-sm text-muted-foreground">Create a purchase order to generate its invoice automatically.</p> : null}</div>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex justify-end"><Link href={context.companyId ? `/companies/${context.companyId}?tab=purchase-orders` : "/purchase-orders"} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>Purchase orders</Link></div>
  </DialogContent></Dialog>;
}
