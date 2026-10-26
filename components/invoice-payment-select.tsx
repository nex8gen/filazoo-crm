"use client";

import Link from "next/link";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { PaymentMethodIcon } from "@/components/payment-method-icon";
import { invoiceRequest } from "@/lib/invoice-client";
import { paymentMethodDetails, paymentMethodTitle, type InvoicePaymentMethod } from "@/lib/invoice-payment-methods";
import type { InvoiceDocument } from "@/lib/invoices";

export function InvoicePaymentSelect({ doc, onChange }: { doc: InvoiceDocument; onChange: Dispatch<SetStateAction<InvoiceDocument>> }) {
  const [methods, setMethods] = useState<InvoicePaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    invoiceRequest("/api/invoices/context?kind=payments", undefined, "GET", controller.signal)
      .then((result) => setMethods(result.paymentMethods))
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  // Keep the invoice snapshot visible, including methods later removed from Settings.
  const selected = doc.paymentMethods ?? [];
  const options = [...methods.map((method) => selected.find((item) => item.id === method.id) ?? method), ...selected.filter((method) => !methods.some((item) => item.id === method.id))];
  return <fieldset className="space-y-3">
    <legend className="mb-2 text-sm font-medium">Customer payment methods</legend>
    <p className="text-xs text-muted-foreground">Choose the ways this customer can pay. Details are copied to this invoice.</p>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading payment methods…</p> : null}
    {options.map((method) => {
      const checked = selected.some((item) => item.id === method.id);
      const mismatch = !!method.currency && method.currency !== doc.currency;
      return <label key={method.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
        <Checkbox className="mt-0.5" checked={checked} disabled={!checked && (loading || !!error || mismatch || selected.length >= 10)} onCheckedChange={(value) => onChange((old) => ({ ...old, paymentMethods: value ? [...(old.paymentMethods ?? []).filter((item) => item.id !== method.id), method] : (old.paymentMethods ?? []).filter((item) => item.id !== method.id) }))} />
        <PaymentMethodIcon type={method.type} className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1"><span className="font-medium">{paymentMethodTitle(method)}</span>{method.currency ? <span className="ml-2 text-xs text-muted-foreground">{method.currency} only</span> : null}{checked ? <><span className="mt-1 block whitespace-pre-line break-words text-xs text-muted-foreground">{paymentMethodDetails(method)}</span>{method.paymentUrl ? <span className="mt-1 block break-all text-xs text-muted-foreground">{method.paymentUrl}</span> : null}</> : null}</span>
      </label>;
    })}
    {!loading && !options.length && !error ? <p className="text-xs text-muted-foreground">No saved payment methods. Add them in Settings, or use the manual instructions below.</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {selected.some((method) => method.currency && method.currency !== doc.currency) ? <p role="alert" className="text-sm text-destructive">Remove payment methods that do not support {doc.currency}.</p> : null}
    <Link href="/settings/payments" target="_blank" rel="noreferrer" className="inline-block text-xs text-primary underline">Manage payment methods in Settings</Link>
  </fieldset>;
}
