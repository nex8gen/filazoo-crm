"use client";
import type { Dispatch, SetStateAction } from "react";
import { InvoicePaymentSelect } from "@/components/invoice-payment-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { orderBillingFromInvoice, orderInvoiceDraft } from "@/lib/purchase-order-billing";
import type { InvoiceDocument } from "@/lib/invoices";
import type { OrderBilling, PurchaseOrderDocument } from "@/lib/purchase-orders";
import "@/app/invoices/invoices.css";

export function PurchaseOrderBillingFields({ document, onChange, locked }: {
  document: PurchaseOrderDocument; onChange: Dispatch<SetStateAction<PurchaseOrderDocument>>; locked: boolean;
}) {
  const doc = orderInvoiceDraft(document);
  const billing = orderBillingFromInvoice(doc, document.billing?.taxBps ?? 0);
  function field<K extends keyof OrderBilling>(key: K, value: OrderBilling[K]) { onChange(old => ({ ...old, billing: { ...orderBillingFromInvoice(orderInvoiceDraft(old), old.billing?.taxBps ?? 0), [key]: value } })); }
  const changeInvoice: Dispatch<SetStateAction<InvoiceDocument>> = update => onChange(old => {
    const previous = orderInvoiceDraft(old);
    const next = typeof update === "function" ? update(previous) : update;
    return { ...old, billing: orderBillingFromInvoice(next, old.billing?.taxBps ?? 0) };
  });
  return <fieldset disabled={locked} className="space-y-5 disabled:opacity-60">
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="po-invoice-date">Issue date</Label><DatePicker id="po-invoice-date" value={billing.issueDate} disabled={locked} onValueChange={value => field("issueDate", value)} /></div><div className="space-y-2"><Label htmlFor="po-payment-due">Payment due date</Label><DatePicker id="po-payment-due" value={billing.dueDate} disabled={locked} min={billing.issueDate} onValueChange={value => field("dueDate", value)} /></div><div className="space-y-2"><Label htmlFor="po-discount">Discount ({document.currency})</Label><Input id="po-discount" type="number" min={0} max={1000000} step="0.01" value={billing.discountMinor / 100} onChange={event => field("discountMinor", Math.round(event.target.valueAsNumber * 100))} /></div><div className="space-y-2"><Label htmlFor="po-tax">Tax (%)</Label><Input id="po-tax" type="number" min={0} max={100} step="0.01" value={billing.taxBps / 100} onChange={event => field("taxBps", Math.round(event.target.valueAsNumber * 100))} /></div></div>
    <InvoicePaymentSelect doc={doc} onChange={changeInvoice} />
  </fieldset>;
}
