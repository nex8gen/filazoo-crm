"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { invoiceCurrencies } from "@/lib/invoices";
import type { InvoiceDefaultsSettings } from "@/lib/invoice-defaults";

export function InvoiceDefaultsForm({ initial, canManage }: { initial: InvoiceDefaultsSettings; canManage: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return <form className="space-y-5" onSubmit={async (event) => {
    event.preventDefault();
    if (!canManage || busy) return;
    const form = new FormData(event.currentTarget);
    const settings = Object.fromEntries(["sellerName", "sellerAddress", "sellerTaxId", "paymentInstructions", "notes"].map((key) => [key, form.get(key)]));
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/invoices/billing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "invoice_defaults", settings, defaults: { currency: form.get("currency"), termsDays: Number(form.get("termsDays")), taxBps: Math.round(Number(form.get("taxPercent")) * 100) } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save invoice defaults.");
      setNotice("Workspace defaults saved. New invoices will use these details.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save invoice defaults."); }
    finally { setBusy(false); }
  }}>
    {!canManage ? <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Only admins and operators can change shared billing defaults.</p> : null}
    <fieldset disabled={!canManage || busy} className="space-y-4 disabled:opacity-60">
      <div className="space-y-2"><Label htmlFor="sellerName">Seller / legal business name</Label><Input id="sellerName" name="sellerName" defaultValue={initial.seller.sellerName} required maxLength={200} /></div>
      <div className="space-y-2"><Label htmlFor="sellerAddress">Business address</Label><Textarea id="sellerAddress" name="sellerAddress" defaultValue={initial.seller.sellerAddress} maxLength={2000} /></div>
      <div className="space-y-2"><Label htmlFor="sellerTaxId">Tax / registration ID</Label><Input id="sellerTaxId" name="sellerTaxId" defaultValue={initial.seller.sellerTaxId} maxLength={100} /></div>
      <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="invoiceCurrency">Currency</Label><Select name="currency" defaultValue={initial.defaults.currency}><SelectTrigger id="invoiceCurrency" className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>{invoiceCurrencies.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="termsDays">Due after (days)</Label><Input id="termsDays" name="termsDays" type="number" min={0} max={365} step={1} required defaultValue={initial.defaults.termsDays} /></div><div className="space-y-2"><Label htmlFor="taxPercent">Default tax (%)</Label><Input id="taxPercent" name="taxPercent" type="number" min={0} max={100} step="0.01" required defaultValue={initial.defaults.taxBps / 100} /></div></div>
      <p className="text-xs leading-5 text-muted-foreground">Zero days means due on the issue date. Tax initializes the first blank line; verify tax on each product line before issuing.</p>
      <div className="space-y-2"><Label htmlFor="paymentInstructions">Payment instructions</Label><Textarea id="paymentInstructions" name="paymentInstructions" defaultValue={initial.seller.paymentInstructions} maxLength={2000} /></div>
      <div className="space-y-2"><Label htmlFor="invoiceNotes">Invoice notes and terms</Label><Textarea id="invoiceNotes" name="notes" defaultValue={initial.seller.notes} maxLength={4000} rows={4} /></div>
      {canManage ? <Button type="submit">{busy ? "Saving..." : "Save invoice defaults"}</Button> : null}
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}{notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
  </form>;
}
