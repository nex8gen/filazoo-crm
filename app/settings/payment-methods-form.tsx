"use client";
import { EmptyState } from "@/components/data-state";
import { Wallet } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useState, type FormEvent } from "react";
import { ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { invoiceRequest } from "@/lib/invoice-client";
import { invoiceCurrencies } from "@/lib/invoices";
import { PaymentMethodIcon } from "@/components/payment-method-icon";
import { invoicePaymentMethodsSchema, paymentMethodLabels, type InvoicePaymentMethod } from "@/lib/invoice-payment-methods";

export function PaymentMethodsForm({ initial, canManage }: { initial: InvoicePaymentMethod[]; canManage: boolean }) {
  const [methods, setMethods] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function update(id: string, patch: Partial<InvoicePaymentMethod>) {
    setMethods((old) => old.map((method) => method.id === id ? { ...method, ...patch } : method));
    setNotice("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setError(""); setNotice("");
    const parsed = invoicePaymentMethodsSchema.safeParse(methods);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Check the payment details.");
      const index = parsed.error.issues[0]?.path[0];
      if (typeof index === "number" && methods[index]) setEditingId(methods[index].id);
      return;
    }
    setBusy(true);
    try {
      await invoiceRequest("/api/invoices/billing", { kind: "payments", paymentMethods: parsed.data }, "PUT");
      setMethods(parsed.data);
      setEditingId(null);
      setNotice("Payment methods saved. Select them when creating or editing an invoice.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save payment methods."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-5">
    {!canManage ? <p className="text-sm text-muted-foreground">An admin or operator can manage payment methods.</p> : null}
    <fieldset disabled={busy} className="space-y-4">
      {methods.length ? methods.map((method, index) => <section key={method.id} aria-label={`Payment method ${index + 1}`} className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted/30"><PaymentMethodIcon type={method.type} className="size-5" /></span><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{method.label || paymentMethodLabels[method.type]}</h3><p className="mt-1 text-xs text-muted-foreground">{paymentMethodLabels[method.type]} · {method.currency || "All invoice currencies"}{method.type === "bank_transfer" && method.bankDetails?.accountNumber ? ` · •••• ${method.bankDetails.accountNumber.slice(-4)}` : ""}</p></div></div>
          <div className="flex items-center gap-1"><Button type="button" variant="ghost" size="sm" aria-label={`${editingId === method.id ? "Collapse" : canManage ? "Edit" : "View"} ${method.label || "payment method"}`} aria-expanded={editingId === method.id} aria-controls={`payment-method-${method.id}`} onClick={() => setEditingId((old) => old === method.id ? null : method.id)}>{editingId === method.id ? <ChevronUp /> : <Pencil />}{editingId === method.id ? "Collapse" : canManage ? "Edit" : "View"}</Button>{canManage ? <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${method.label || "payment method"}`} onClick={() => { setMethods((old) => old.filter((item) => item.id !== method.id)); setNotice(""); }}><Trash2 />Remove</Button> : null}</div>
        </div>
        {editingId === method.id ? <fieldset disabled={!canManage} id={`payment-method-${method.id}`} className="space-y-4 border-t pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">Payment type<Select value={method.type} onValueChange={(selectedValue) => { if (selectedValue === null) return;
            const type = selectedValue as InvoicePaymentMethod["type"];
            update(method.id, { type, bankDetails: type === "bank_transfer" ? method.bankDetails ?? { beneficiaryName: "", accountNumber: "", swift: "", bankName: "" } : undefined, label: method.label === paymentMethodLabels[method.type] ? paymentMethodLabels[type] : method.label });
           }}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(paymentMethodLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
          <label className="grid gap-2 text-sm">Display name<Input required maxLength={100} value={method.label} onChange={(event) => update(method.id, { label: event.target.value })} placeholder="e.g. USD bank account" /></label>
        </div>
        <label className="grid gap-2 text-sm">Currency<Select value={method.currency} onValueChange={(selectedValue) => { if (selectedValue === null) return; update(method.id, { currency: selectedValue as InvoicePaymentMethod["currency"] }); }}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="">All invoice currencies</SelectItem>{invoiceCurrencies.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></label>
        {method.type === "bank_transfer" && method.bankDetails ? <div className="grid gap-4 sm:grid-cols-2">
          {([["beneficiaryName", "Beneficiary", 200], ["accountNumber", "Account number", 100], ["swift", "SWIFT / BIC code", 11], ["bankName", "Bank name", 200]] as const).map(([key, label, maxLength]) => <label key={key} className="grid gap-2 text-sm">{label}<Input required maxLength={maxLength} value={method.bankDetails![key]} onChange={(event) => update(method.id, { bankDetails: { ...method.bankDetails!, [key]: key === "swift" ? event.target.value.toUpperCase() : event.target.value } })} /></label>)}
        </div> : null}
        <label className="grid gap-2 text-sm">{method.type === "bank_transfer" ? method.bankDetails ? "Additional transfer instructions (optional)" : "Bank details" : method.type === "paypal" ? "PayPal email and instructions" : "Payment instructions"}<Textarea rows={4} required={method.type === "bank_transfer" ? !method.bankDetails : !method.paymentUrl.trim()} maxLength={2000} value={method.details} onChange={(event) => update(method.id, { details: event.target.value })} placeholder={method.type === "bank_transfer" ? method.bankDetails ? "Include your invoice number as the transfer reference" : "Beneficiary, bank name, account number / IBAN, SWIFT / BIC, and transfer instructions" : method.type === "paypal" ? "payments@example.com" : "Tell customers how to pay"} /></label>
        <label className="grid gap-2 text-sm">Payment link (optional)<Input type="url" maxLength={1000} value={method.paymentUrl} onChange={(event) => update(method.id, { paymentUrl: event.target.value })} placeholder={method.type === "paypal" ? "https://www.paypal.me/yourbusiness" : "https://"} /></label>
        </fieldset> : null}
      </section>) : <EmptyState compact icon={Wallet} title="No payment methods added yet" description="Add bank transfer, PayPal, or another way for customers to pay." />}
      {canManage ? <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={methods.length >= 10} onClick={() => {
        const id = crypto.randomUUID();
        setMethods((old) => [...old, { id, type: "bank_transfer", label: "Bank transfer", currency: "", details: "", paymentUrl: "", bankDetails: { beneficiaryName: "", accountNumber: "", swift: "", bankName: "" } }]); setEditingId(id); setNotice("");
      }}><Plus />Add payment method</Button><Button type="submit">{busy ? "Saving…" : "Save payment methods"}</Button></div> : null}
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
    <p className="text-xs leading-5 text-muted-foreground">Select one or more saved methods on each invoice. Customers see those details and payment links on their invoice. Record payments after confirming receipt.</p>
  </form>;
}
