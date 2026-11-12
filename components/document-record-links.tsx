"use client";
import { useEffect, useState } from "react";
import { Loader2, Package2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DocumentCategory } from "@/lib/documents";
import type { DocumentConnectionContext, DocumentConnections } from "@/lib/document-connections";

export function DocumentRecordLinks({ category, value, onChange, disabled = false }: { category: DocumentCategory; value: DocumentConnections; onChange: (value: DocumentConnections) => void; disabled?: boolean }) {
  const [context, setContext] = useState<DocumentConnectionContext | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/documents/context", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load CRM records.");
      if (!controller.signal.aborted) { setContext(body); setError(""); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load CRM records."); });
    return () => controller.abort();
  }, [attempt]);
  const ordersNeeded = ["proforma", "invoice", "payment", "purchase_order"].includes(category);
  const productsShown = ["quotation", "catalog", "datasheet", "certificate"].includes(category);
  const invoices = context?.invoices.filter(invoice => invoice.purchase_order_id === value.purchase_order_id && (category === "proforma" ? invoice.status === "draft" : category === "invoice" ? invoice.status === "issued" : true)) ?? [];
  const products = context?.products.filter(product => `${product.name} ${product.sku}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <div className="library-record-links">
    <div className="library-links-title"><Package2 /><strong>{category === "quotation" ? "Quotation connections" : ordersNeeded ? "Order connections" : "Related CRM records"}</strong></div>
    {error ? <div role="alert" className="text-xs text-destructive">{error}<Button type="button" variant="ghost" size="xs" onClick={() => setAttempt(value => value + 1)}><RefreshCw />Retry</Button></div> : !context ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading CRM records…</p> : null}
    <div className="library-form-row"><label>Customer {category === "quotation" || category === "purchase_order" ? "*" : ""}<RecordSelect label="Linked customer" disabled={disabled || !context} value={value.company_id} placeholder={ordersNeeded ? "Select customer or choose an order" : "Choose a customer"} options={(context?.companies ?? []).map(company => ({ value: company.id, label: company.name }))} onChange={company_id => onChange({ ...value, company_id, purchase_order_id: null, invoice_id: null })} /></label>
    {ordersNeeded ? <label>Purchase order {category !== "purchase_order" ? "*" : ""}<RecordSelect label="Linked purchase order" disabled={disabled || !context} value={value.purchase_order_id} placeholder="Choose a purchase order" options={(context?.orders ?? []).filter(order => !value.company_id || order.company_id === value.company_id).map(order => ({ value: order.id, label: '#' + order.number + ' - ' + order.company + (order.reference ? ' - ' + order.reference : '') }))} onChange={id => { const order = context?.orders.find(item => item.id === id); onChange({ ...value, purchase_order_id: order?.id ?? null, company_id: order?.company_id ?? value.company_id, invoice_id: null }); }} /></label> : null}</div>
    {ordersNeeded && category !== "purchase_order" && value.purchase_order_id ? <label>Linked invoice<RecordSelect label="Linked invoice" disabled={disabled || !context} value={value.invoice_id} placeholder="Order document / no specific invoice" options={invoices.map(invoice => ({ value: invoice.id, label: '#' + invoice.number + ' - ' + invoice.status }))} onChange={invoice_id => onChange({ ...value, invoice_id })} /></label> : null}
    {productsShown ? <div className="library-linked-products"><div className="flex items-center justify-between text-xs"><span>Products {category === "certificate" ? "(optional)" : "*"}</span><span className="text-muted-foreground">{value.product_skus.length} selected</span></div><div className="library-product-search"><Search /><Input aria-label="Search related products" disabled={disabled} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search product name or SKU" /></div><div className="library-product-options">{products.slice(0, 100).map(product => <label key={product.sku}><input type="checkbox" disabled={disabled || (!value.product_skus.includes(product.sku) && value.product_skus.length >= 100)} checked={value.product_skus.includes(product.sku)} onChange={event => onChange({ ...value, product_skus: event.target.checked ? [...value.product_skus, product.sku] : value.product_skus.filter(sku => sku !== product.sku) })} /><span>{product.name}<small>{product.sku} · {product.currency}</small></span></label>)}{context && !products.length ? <p className="p-3 text-xs text-muted-foreground">No matching products.</p> : null}{value.product_skus.filter(sku => !context?.products.some(product => product.sku === sku)).map(sku => <label key={sku}><input type="checkbox" checked disabled={disabled} onChange={() => onChange({ ...value, product_skus: value.product_skus.filter(item => item !== sku) })} /><span>{sku}<small>Previously linked product</small></span></label>)}</div>{products.length > 100 ? <p className="library-field-hint">Showing 100 matches. Search to narrow your selection.</p> : null}</div> : null}
    {ordersNeeded ? <p className="library-field-hint">The customer and products follow the selected order. Uploading a file does not issue an invoice or record a payment.</p> : null}
  </div>;
}

function RecordSelect({ label, value, placeholder, options, onChange, disabled }: { label: string; value: string | null; placeholder: string; options: { value: string; label: string }[]; onChange: (value: string | null) => void; disabled: boolean }) {
  return <Select value={value ?? "none"} disabled={disabled} onValueChange={next => onChange(next === "none" ? null : next)}><SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{placeholder}</SelectItem>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}{value && !options.some(option => option.value === value) ? <SelectItem value={value}>Current linked record</SelectItem> : null}</SelectContent></Select>;
}
