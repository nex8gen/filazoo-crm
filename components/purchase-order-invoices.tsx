"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Download, Eye, Mail } from "lucide-react";
import { toast } from "sonner";
import { formatMoney, invoiceLabel } from "@/lib/invoices";
import type { PurchaseOrder } from "@/lib/purchase-orders";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SendDialog = dynamic(() => import("@/components/order-invoice-send-dialog").then(module => module.OrderInvoiceSendDialog));
const Preview = dynamic(() => import("@/components/order-invoice-preview").then(module => module.OrderInvoicePreview));

export function PurchaseOrderInvoices({ order, canWrite }: { order: PurchaseOrder; canWrite: boolean }) {
  const router = useRouter();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sendId, setSendId] = useState<string | null>(null);
  const invoices = order.invoices ?? [];
  return <section aria-labelledby="order-invoices" className="space-y-4">
    <div><h3 id="order-invoices" className="text-sm font-medium">Invoice</h3><p className="mt-1 text-xs text-muted-foreground">{invoices.some(invoice => invoice.order_managed && invoice.status === "draft") ? "The draft updates with this order until it is issued." : "Preview, download, or email invoices for this order."}</p></div>
    {invoices.length ? <div className="divide-y rounded-2xl border bg-card px-4 shadow-sm">{invoices.map(invoice => {
      const currency = invoice.document.currency;
      const status = invoice.status === "issued" ? invoice.paid_minor >= invoice.total_minor ? "Paid" : invoice.paid_minor > 0 ? "Partially paid" : invoice.last_sent_at ? "Sent" : "Issued" : invoice.status === "draft" ? "Draft" : "Void";
      return <article key={invoice.id} aria-label={invoiceLabel(invoice)} className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="text-sm font-medium">Invoice {invoiceLabel(invoice)}</span><span className={`rounded-full px-2 py-0.5 text-[11px] ${status === "Paid" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{status}</span></div><p className="text-sm font-medium tabular-nums">{formatMoney(invoice.total_minor, currency)}</p></div>
        {invoice.status === "issued" ? <p className="text-xs text-muted-foreground">Received {formatMoney(invoice.paid_minor, currency)} · Balance {formatMoney(invoice.total_minor - invoice.paid_minor, currency)}</p> : null}
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setPreviewId(invoice.id)}><Eye className="size-3.5" />Preview</Button><a href={`/api/invoices/${invoice.id}/pdf`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="size-3.5" />Download PDF</a>{canWrite && invoice.status !== "void" ? <Button variant="outline" size="sm" onClick={() => setSendId(invoice.id)}><Mail className="size-3.5" />Send invoice</Button> : null}</div>
      </article>;
    })}</div> : <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">{order.document.status === "cancelled" ? "This order is cancelled." : "The order invoice is unavailable. Reload the order to try again."}</p>}
    <Dialog open={Boolean(previewId)} onOpenChange={open => { if (!open) setPreviewId(null); }}><DialogContent className="flex h-[90dvh] flex-col sm:max-w-5xl"><DialogHeader><DialogTitle>Invoice preview</DialogTitle><DialogDescription>Review the invoice before downloading or sending the PDF.</DialogDescription></DialogHeader>{previewId ? <Preview key={previewId} invoiceId={previewId} /> : null}</DialogContent></Dialog>
    {sendId ? <SendDialog invoiceId={sendId} orderStatus={order.document.status} onClose={() => setSendId(null)} onSent={message => { setSendId(null); toast.success(message); router.refresh(); }} /> : null}
  </section>;
}
