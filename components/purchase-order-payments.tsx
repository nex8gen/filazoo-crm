"use client";
import { NotificationToast } from "@/components/ui/notification-toast";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { invoiceRequest } from "@/lib/invoice-client";
import { canManageBilling } from "@/lib/invoice-permissions";
import { formatMoney, type Invoice } from "@/lib/invoices";
import type { OrderBilling, PurchaseOrder } from "@/lib/purchase-orders";
import { paymentMethodDetails, paymentMethodTitle } from "@/lib/invoice-payment-methods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";

export function PurchaseOrderPaymentDetails({ billing }: { billing?: OrderBilling }) {
  if (!billing) return null;
  return <div className="space-y-3 border-t px-4 py-4 text-xs">
    {billing.paymentMethods?.map(method => <div key={method.id}><p className="font-medium">{paymentMethodTitle(method)}</p><p className="mt-1 whitespace-pre-line break-words text-muted-foreground">{paymentMethodDetails(method)}</p></div>)}
  </div>;
}

export function PurchaseOrderPayments({ order, canWrite }: { order: PurchaseOrder; canWrite: boolean }) {
  const router = useRouter();
  const active = order.invoices?.find(invoice => invoice.status !== "void");
  const activeId = active?.id;
  const [context, setContext] = useState<{ invoice: Invoice; invoiceViewer: { id: string; role: string } } | null>(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const paymentId = useRef<string | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    invoiceRequest(`/api/invoices/${activeId}`, undefined, undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setContext(data);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Payment details could not be loaded."); });
    return () => controller.abort();
  }, [activeId, active?.paid_minor, active?.status]);
  async function record(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      let invoice = context.invoice;
      if (invoice.status === "draft") {
        const issued = await invoiceRequest(`/api/invoices/${invoice.id}`, { action: "issue", revision: invoice.revision });
        invoice = issued.invoice;
        setContext({ ...context, invoice });
      }
      paymentId.current ??= crypto.randomUUID();
      await invoiceRequest(`/api/invoices/${invoice.id}`, { action: "payment", payment: { id: paymentId.current, amountMinor: Math.round(Number(amount) * 100), paidOn, method, reference } });
      toast.success("Payment recorded."); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to record payment. Reload the order before trying again."); }
    finally { setBusy(false); submitting.current = false; }
  }
  if (!active) return null;
  const canRecord = context && canWrite && canManageBilling(context.invoiceViewer.role) && !["draft","cancelled"].includes(order.document.status) && context.invoice.paid_minor < context.invoice.total_minor;
  return <div className="space-y-3 border-t px-4 py-4">
    {context?.invoice.invoice_payments?.length ? <ul className="divide-y text-xs">{context.invoice.invoice_payments.map(payment => <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{payment.paid_on} · {payment.method.replaceAll("_"," ")}{payment.reference ? ` · ${payment.reference}` : ""}</span><strong>{formatMoney(payment.amount_minor, order.document.currency)}</strong></li>)}</ul> : null}
    {canRecord ? <form onSubmit={event => void record(event)} className="grid items-end gap-3 sm:grid-cols-2"><label className="grid gap-2 text-xs">Amount received ({order.document.currency})<Input type="number" required min="0.01" max={(context.invoice.total_minor-context.invoice.paid_minor)/100} step="0.01" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /></label><label className="grid gap-2 text-xs">Payment date<DatePicker value={paidOn} max={today} disabled={busy} onValueChange={setPaidOn} /></label><label className="grid gap-2 text-xs">Method<select className="h-9 rounded-md border bg-background px-3" value={method} disabled={busy} onChange={event => setMethod(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label><label className="grid gap-2 text-xs">Reference<Input maxLength={200} value={reference} disabled={busy} onChange={event => setReference(event.target.value)} /></label><p className="text-xs text-muted-foreground">Recording a payment finalizes the order’s billing details.</p><Button type="submit" disabled={busy}>{busy ? "Recording…" : "Record payment"}</Button></form> : null}
    {error ? <NotificationToast>{error}</NotificationToast> : null}
  </div>;
}
