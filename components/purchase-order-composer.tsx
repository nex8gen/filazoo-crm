"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useEffect, useImperativeHandle, useRef, useState, useTransition, type Ref } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe2, Package2, Pencil, Plus, Search, X } from "lucide-react";
import { getPurchaseOrderProfile, savePurchaseOrder } from "@/app/purchase-order-actions";
import { applyOrderProfile, customOrderLine, refreshOrderProductLine } from "@/lib/purchase-order-links";
import { changeDraftQuantity, draftPaymentTotals, draftProductAvailable, orderShippingSku, productSelectionKey, purchaseOrderCommercialDetailsLocked, purchaseOrderEditorDocument } from "@/lib/purchase-order-draft";
import { purchaseOrderCreateSchema, purchaseOrderLabel, purchaseOrderSchema, type OrderProfile, type PurchaseOrder, type PurchaseOrderDocument } from "@/lib/purchase-orders";
import { productUnitPrice, type InvoiceProduct } from "@/lib/invoice-links";
import { purchaseOrderAmounts } from "@/lib/purchase-order-billing";
import { purchaseOrdersHref } from "@/lib/purchase-order-overview";
import type { OrderBilling } from "@/lib/purchase-orders";
import { PurchaseOrderBillingFields } from "@/components/purchase-order-billing-fields";
import { formatMoney, invoiceCurrencies } from "@/lib/invoices";
import { PageActions } from "@/components/page-header";
import { PurchaseOrderProfileFields } from "@/components/purchase-order-profile-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ProductDialog = dynamic(() => import("@/components/purchase-order-product-dialog").then(module => module.PurchaseOrderProductDialog));
const AddCustomerButton = dynamic(() => import("@/components/crm-action-dialogs").then(module => module.AddCompanyButton));
type OrderItem = PurchaseOrderDocument["items"][number];
const currencyLabels = { USD: "US Dollar (USD $)", EUR: "Euro (EUR €)", GBP: "British Pound (GBP £)", CNY: "Chinese Yuan (CNY ¥)", CAD: "Canadian Dollar (CAD $)", AUD: "Australian Dollar (AUD $)", HKD: "Hong Kong Dollar (HKD $)" };

export type PurchaseOrderComposerHandle = { requestClose: () => void };

export function PurchaseOrderComposer({ companies, initialCompanyId, initialProfile, initialOrder, initialBilling, initialProducts = [], catalogError = false, today, panel, ref }: {
  companies: { id: string; name: string }[];
  initialCompanyId: string;
  initialProfile: OrderProfile | null;
  initialOrder?: PurchaseOrder;
  initialBilling?: OrderBilling;
  initialProducts?: InvoiceProduct[];
  catalogError?: boolean;
  today: string;
  panel?: { onClose: () => void; onSaved: (orderId: string) => void };
  ref?: Ref<PurchaseOrderComposerHandle>;
}) {
  const router = useRouter();
  const [order] = useState(initialOrder);
  const [document, setDocument] = useState(() => { const draft = purchaseOrderEditorDocument(today, initialProfile, initialOrder); return initialBilling && !draft.billing ? { ...draft, billing: initialBilling } : draft; });
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [profile, setProfile] = useState(initialProfile);
  const [customers, setCustomers] = useState(companies);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [tags, setTags] = useState(() => initialOrder?.document.tags?.join(", ") ?? "");
  const [productsOpen, setProductsOpen] = useState(false);
  const [customerDetailsOpen, setCustomerDetailsOpen] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [itemEditor, setItemEditor] = useState<{ index: number | null; item: OrderItem } | null>(null);
  const [productCache, setProductCache] = useState(() => new Map(initialProducts.filter(product => product.currency === document.currency).map(product => [product.sku, product])));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(catalogError ? "Catalog data could not be loaded. Reload before changing catalog quantities." : "");
  const selectionRequest = useRef(0);
  const saved = useRef(false);
  const saving = useRef(false);
  const [initialDocument] = useState(() => JSON.stringify(document));
  const [initialTags] = useState(() => initialOrder?.document.tags?.join(", ") ?? "");
  const dirty = companyId !== initialCompanyId || tags !== initialTags || JSON.stringify(document) !== initialDocument;
  const locked = purchaseOrderCommercialDetailsLocked(order);
  const returnPath = order ? `/purchase-orders/${order.id}` : purchaseOrdersHref({}, true, initialCompanyId || undefined);
  const totals = draftPaymentTotals(document.items);
  const amounts = purchaseOrderAmounts(document);
  const hasProducts = document.items.some(item => item.sku !== orderShippingSku || item.productSku);
  const existingKeys = new Set(document.items.flatMap(item => item.productSku ? [productSelectionKey(item.productSku, item.variantId)] : []));
  const matches = customers.filter(company => company.name.toLocaleLowerCase().includes(customerSearch.trim().toLocaleLowerCase())).slice(0, 30);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { if (!saved.current) event.preventDefault(); };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  function close() {
    saved.current = true;
    if (panel) panel.onClose(); else router.push(returnPath);
  }
  function requestClose() {
    if (pending || saving.current) return;
    if (dirty) setDiscardOpen(true); else close();
  }
  useImperativeHandle(ref, () => ({ requestClose }));

  function change<K extends keyof PurchaseOrderDocument>(key: K, value: PurchaseOrderDocument[K]) {
    setDocument(current => ({ ...current, [key]: value }));
  }
  function selectCustomer(id: string) {
    if (locked || (order && id !== order.company_id) || (panel && id !== initialCompanyId)) return;
    const request = ++selectionRequest.current;
    startTransition(async () => {
      try {
        const next = await getPurchaseOrderProfile(id);
        if (request !== selectionRequest.current) return;
        setProfile(next); setCompanyId(id); setCustomerOpen(false); setCustomerSearch(""); setError("");
        setDocument(current => applyOrderProfile({ ...current, currency: current.items.length ? current.currency : next.commerce.currency }, next));
        setCustomers(current => current.some(company => company.id === id) ? current : [...current, { id, name: next.customer.companyName }]);
      } catch { if (request === selectionRequest.current) setError("The customer profile could not be loaded. Please try again."); }
    });
  }
  function save() {
    if (pending || saving.current) return;
    if (!companyId) { setError("Choose a customer before saving the order."); setCustomerOpen(true); return; }
    const parsed = (order ? purchaseOrderSchema : purchaseOrderCreateSchema).safeParse({ ...document, tags: [...new Set(tags.split(",").map(tag => tag.trim()).filter(Boolean))] });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Check the order details before saving."); return; }
    saving.current = true;
    setError("");
    startTransition(async () => {
      try {
        const result = await savePurchaseOrder(companyId, order?.id ?? null, order?.version ?? 0, parsed.data);
        if (result.error || !result.orderId) setError(result.error || "The order could not be saved. Please try again.");
        else {
          saved.current = true;
          if (panel) panel.onSaved(result.orderId);
          else { router.replace(`/purchase-orders/${result.orderId}`); router.refresh(); }
        }
      } catch { setError("The order could not be saved. Please try again."); }
      finally { saving.current = false; }
    });
  }
  function editShipping() {
    if (locked) return;
    const index = document.items.findIndex(item => item.sku === orderShippingSku && !item.productSku);
    setItemEditor({ index: index < 0 ? null : index, item: index < 0 ? { description: "Shipping / delivery", sku: orderShippingSku, quantity: 1, unitPriceMinor: 0 } : document.items[index] });
  }

  return <div className={panel ? "min-w-0 pb-6" : "mx-auto max-w-[1100px] pb-12 pt-3"}>
    {panel ? <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background px-5 py-4 sm:px-6">
      <h2 className="text-base font-semibold">New purchase order</h2>
      <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={pending} onClick={requestClose}>Cancel</Button><Button type="button" size="sm" disabled={pending || !document.items.length} onClick={save}>{pending ? "Saving..." : "Save draft"}</Button><Button type="button" variant="ghost" size="icon-sm" aria-label="Close order panel" disabled={pending} onClick={requestClose}><X className="size-4" /></Button></div>
    </header> : <>
      <PageActions><div className="flex items-center gap-2 rounded-full bg-foreground py-1 pr-1 pl-4 text-background shadow-sm"><span className="mr-2 hidden text-xs sm:inline">{dirty ? "Unsaved changes" : order ? "Editing order" : "New draft"}</span><Button variant="ghost" size="sm" className="rounded-full text-background hover:bg-background/15 hover:text-background" disabled={pending} onClick={requestClose}>Discard</Button><Button size="sm" className="rounded-full bg-background text-foreground hover:bg-background/90" disabled={pending || !document.items.length || (Boolean(order) && !dirty)} onClick={save}>{pending ? "Saving..." : "Save"}</Button></div></PageActions>
      <Link href={returnPath} onClick={event => { if (dirty) { event.preventDefault(); setDiscardOpen(true); } }} className="mb-5 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{order ? "Back to order" : initialCompanyId ? "Customer orders" : "Drafts"}</Link>
    </>}
    {error ? <NotificationToast>{error}</NotificationToast> : null}
    <fieldset disabled={pending} className={panel ? "grid min-w-0 gap-6 p-5 sm:p-6" : "grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12"}>
      <div className="min-w-0 space-y-9">
        {panel ? <section aria-label="Order customer" className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-muted/20 p-4"><div className="space-y-1"><h3 className="text-xs font-medium text-muted-foreground">Customer</h3><p data-no-translate className="text-sm font-semibold">{document.customer?.companyName || initialProfile?.customer.companyName}</p>{document.customer?.contactName ? <p className="text-sm">{document.customer.contactName}</p> : null}{document.customer?.contactEmail ? <p className="break-all text-xs text-muted-foreground">{document.customer.contactEmail}</p> : null}</div><Button type="button" variant="outline" size="sm" onClick={() => setCustomerDetailsOpen(true)}>Edit customer details</Button></section> : <div><h2 className="text-2xl font-medium tracking-tight">{order ? `Edit order ${purchaseOrderLabel(order)}` : "Create order"}</h2>{order ? null : <p className="mt-1.5 text-xs text-muted-foreground">Order number assigned automatically on save</p>}</div>}
        <section aria-labelledby="create-po-products" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="create-po-products" className="text-sm font-medium">Products</h3>{hasProducts ? <ProductCommands disabled={locked || document.items.length >= 100} onProducts={() => setProductsOpen(true)} onCustom={() => setItemEditor({ index: null, item: { description: "", sku: "", quantity: 1, unitPriceMinor: 0 } })} /> : null}</div>
          {hasProducts ? <div className="divide-y overflow-hidden rounded-2xl border bg-card px-4 shadow-sm">{document.items.map((item, index) => item.sku === orderShippingSku && !item.productSku ? null : <div key={index} className="grid grid-cols-[40px_minmax(0,1fr)_32px] items-center gap-3 py-4 sm:grid-cols-[40px_minmax(0,1fr)_70px_76px_80px_28px]">
            {item.imageUrl ? <Image src={item.imageUrl} alt="" width={40} height={40} unoptimized className="size-10 rounded-lg border object-cover" /> : <div className="grid size-10 place-items-center rounded-lg border bg-muted"><Package2 className="size-4 text-muted-foreground" /></div>}
            <div className="min-w-0"><p className="text-sm font-medium leading-5">{item.description}</p><p className="mt-1 text-xs text-muted-foreground">{item.productSku ? item.sku : "Custom item"}</p></div>
            <Button variant="ghost" size="icon-sm" className="sm:order-last" disabled={locked} aria-label={`Remove ${item.description}`} onClick={() => change("items", document.items.filter((_, i) => i !== index))}><X className="size-4 text-muted-foreground" /></Button>
            <button type="button" disabled={locked} className="col-start-2 text-left text-sm text-primary underline-offset-4 hover:underline disabled:text-foreground disabled:no-underline sm:col-auto sm:text-right" aria-label={`Edit price for ${item.description}`} onClick={() => setItemEditor({ index, item })}>{formatMoney(item.unitPriceMinor, document.currency)}</button>
            <Input type="number" readOnly={locked || (item.pricingMode === "catalog" && !draftProductAvailable(item, productCache.get(item.productSku!), document.currency))} aria-label={`Quantity for ${item.description}`} min={item.pricingMode === "catalog" ? productCache.get(item.productSku!)?.moq ?? 1 : 1} max={1000000} step={1} value={Number.isNaN(item.quantity) ? "" : item.quantity} className="col-start-2 h-8 w-20 sm:col-auto sm:w-full" onChange={event => { const quantity = event.target.valueAsNumber; change("items", document.items.map((line, i) => i === index ? changeDraftQuantity(line, quantity, productCache.get(line.productSku!)) : line)); }} />
            <span className="col-start-2 text-sm tabular-nums sm:col-auto sm:text-right">{formatMoney(Number.isFinite(item.quantity * item.unitPriceMinor) ? item.quantity * item.unitPriceMinor : 0, document.currency)}</span>
          </div>)}</div> : <div className="flex min-h-20 items-center justify-center rounded-2xl border border-dashed"><ProductCommands disabled={locked || document.items.length >= 100} onProducts={() => setProductsOpen(true)} onCustom={() => setItemEditor({ index: null, item: { description: "", sku: "", quantity: 1, unitPriceMinor: 0 } })} /></div>}
        </section>
        <section aria-labelledby="create-po-payment" className="space-y-4">
          <h3 id="create-po-payment" className="text-sm font-medium">Payment</h3>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm"><dl className="space-y-4 p-4 text-sm">
            <div className="flex items-center justify-between gap-3"><dt>Subtotal <span className="ml-2 text-xs text-muted-foreground">{totals.quantity || 0} items</span></dt><dd className="tabular-nums">{formatMoney(Number.isFinite(totals.subtotal) ? totals.subtotal : 0, document.currency)}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt><button type="button" className="text-primary hover:underline disabled:text-muted-foreground" disabled={locked || !hasProducts || (document.items.length >= 100 && !totals.shipping)} onClick={editShipping}>{totals.shipping ? "Shipping / delivery" : "Add shipping or delivery"}</button></dt><dd className="tabular-nums">{formatMoney(totals.shipping, document.currency)}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt>Discount</dt><dd className="tabular-nums">{formatMoney(document.billing?.discountMinor || 0, document.currency)}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt>Tax</dt><dd className="tabular-nums">{formatMoney(Number.isFinite(amounts.tax) ? amounts.tax : 0, document.currency)}</dd></div>
            <div className="flex items-center justify-between gap-3 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(Number.isFinite(amounts.total) ? amounts.total : 0, document.currency)} <span className="text-xs">{document.currency}</span></dd></div>
          </dl><div className="border-t bg-muted/20 px-4 py-4 text-xs">{locked ? "Issued order billing details are locked." : "Saving this order automatically creates or updates its invoice with the same order number."}</div></div>
          <PurchaseOrderBillingFields document={document} onChange={setDocument} locked={locked} />
          {document.items.length ? <div className="space-y-3"><Label htmlFor="new-po-payment-policy">Payment terms</Label><Select value={document.paymentPolicy} onValueChange={value => { if (value) change("paymentPolicy", value); }}><SelectTrigger id="new-po-payment-policy" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full_before_shipment">100% payment before shipment</SelectItem><SelectItem value="custom">Different agreed terms</SelectItem></SelectContent></Select>{document.paymentPolicy === "custom" ? <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]"><div className="space-y-2"><Label htmlFor="new-po-percent">Before shipment (%)</Label><Input id="new-po-percent" type="number" min={0} max={100} value={document.preShipmentPercent} onChange={event => change("preShipmentPercent", event.target.valueAsNumber)} /></div><div className="space-y-2"><Label htmlFor="new-po-terms">Agreed terms</Label><Textarea id="new-po-terms" value={document.paymentTerms} maxLength={2000} onChange={event => change("paymentTerms", event.target.value)} /></div></div> : null}</div> : null}
        </section>
      </div>
      <aside aria-label="Order customer and details" className="min-w-0 divide-y lg:pt-1">
        <section className="pb-5"><div className="flex items-center justify-between"><Label htmlFor="new-po-notes">Notes</Label><Button variant="ghost" size="icon-sm" aria-label="Edit order notes" aria-expanded={notesOpen} onClick={() => setNotesOpen(open => !open)}><Plus className="size-4 text-muted-foreground" /></Button></div>{notesOpen || document.notes ? <Textarea id="new-po-notes" className="mt-3" value={document.notes} maxLength={5000} placeholder="Add a note to this order" onChange={event => change("notes", event.target.value)} /> : null}</section>
        {!panel ? <section className="relative space-y-3 py-5"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Customer</h3>{companyId && !order ? <Button variant="ghost" size="icon-xs" aria-label="Remove customer" onClick={() => { selectionRequest.current++; setCompanyId(""); setProfile(null); setDocument(current => ({ ...current, customer: undefined, shippingAddress: "", shippingRecipient: "", shippingPhone: "" })); }}><X className="size-3.5" /></Button> : null}</div>
          {companyId && document.customer ? <div className="space-y-2 text-sm"><Link href={`/companies/${companyId}`} className="font-medium text-primary hover:underline">{document.customer.companyName}</Link>{document.customer.contactName ? <p>{document.customer.contactName}</p> : null}{document.customer.contactEmail ? <p className="break-all text-primary">{document.customer.contactEmail}</p> : null}<button type="button" disabled={locked} onClick={() => setCustomerDetailsOpen(true)} className="text-xs text-muted-foreground underline underline-offset-4">Edit customer details</button></div> : <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden /><Input value={customerSearch} onFocus={() => setCustomerOpen(true)} onChange={event => { setCustomerSearch(event.target.value); setCustomerOpen(true); }} onKeyDown={event => { if (event.key === "Escape") setCustomerOpen(false); }} aria-label="Search or create a customer" aria-expanded={customerOpen} aria-controls="po-customer-results" placeholder="Search or create a customer" className="h-9 pl-9 text-xs" />{customerOpen ? <div id="po-customer-results" className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-xl border bg-popover p-1 shadow-lg"><div className="flex items-center justify-between border-b p-2"><AddCustomerButton canWrite label="Create a customer" onCreated={selectCustomer} /><Button variant="ghost" size="icon-xs" aria-label="Close customer search" onClick={() => setCustomerOpen(false)}><X className="size-3" /></Button></div><div className="max-h-72 overflow-y-auto">{matches.map(company => <button type="button" key={company.id} className="w-full rounded-lg px-3 py-3 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={() => selectCustomer(company.id)}>{company.name}</button>)}{!matches.length ? <p className="p-3 text-xs text-muted-foreground">No matching customers</p> : null}</div></div> : null}</div>}
        </section> : null}
        {companyId ? <><section className="py-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium">Shipping address</h3><Button variant="ghost" size="icon-xs" aria-label="Edit shipping address" onClick={() => setShippingOpen(true)}><Pencil className="size-3.5 text-muted-foreground" /></Button></div><div className="space-y-1 text-sm leading-6"><p>{document.shippingRecipient || document.customer?.companyName}</p><p className="whitespace-pre-line">{document.shippingAddress || "No shipping address"}</p>{document.shippingPhone ? <p>{document.shippingPhone}</p> : null}</div></section><section className="py-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium">Billing address</h3><Button variant="ghost" size="icon-xs" aria-label="Edit billing address" disabled={locked} onClick={() => setCustomerDetailsOpen(true)}><Pencil className="size-3.5 text-muted-foreground" /></Button></div><p className="whitespace-pre-line text-sm leading-6">{document.customer?.billingAddress || "No billing address"}</p></section></> : null}
        <section className="space-y-4 py-5"><h3 className="text-sm font-medium">Markets</h3><span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs"><Globe2 className="size-3.5" />{profile?.country || "Select a customer"}</span><div className="space-y-2"><Label htmlFor="new-po-currency">Currency</Label><Select value={document.currency} onValueChange={value => { if (value) change("currency", value); }} disabled={locked || document.items.length > 0}><SelectTrigger id="new-po-currency" className="w-full text-xs"><SelectValue /></SelectTrigger><SelectContent>{invoiceCurrencies.map(currency => <SelectItem key={currency} value={currency}>{currencyLabels[currency]}</SelectItem>)}</SelectContent></Select>{document.items.length ? <p className="text-[11px] text-muted-foreground">Remove order items to change currency.</p> : null}</div></section>
        <section className="space-y-3 py-5"><Label htmlFor="new-po-tags">Tags</Label><Input id="new-po-tags" value={tags} maxLength={820} onChange={event => setTags(event.target.value)} aria-describedby="new-po-tags-help" className="h-9" /><p id="new-po-tags-help" className="text-[11px] text-muted-foreground">Separate tags with commas.</p></section>
        <details className="py-5"><summary className="cursor-pointer text-sm font-medium">Order details</summary><div className="mt-4 space-y-4"><div className="space-y-2"><Label htmlFor="new-po-reference">Customer PO reference (optional)</Label><Input id="new-po-reference" readOnly={locked} value={document.reference} maxLength={100} onChange={event => change("reference", event.target.value)} /></div><div className="space-y-2"><Label htmlFor="new-po-order-date">Order date</Label><DatePicker id="new-po-order-date" value={document.orderDate} onValueChange={value => change("orderDate", value)} /></div><div className="space-y-2"><Label htmlFor="new-po-delivery">Expected delivery</Label><DatePicker id="new-po-delivery" value={document.deliveryDate} onValueChange={value => change("deliveryDate", value)} /></div></div></details>
      </aside>
    </fieldset>
    {productsOpen && !locked ? <ProductDialog currency={document.currency} existingKeys={existingKeys} limit={100 - document.items.length} onClose={() => setProductsOpen(false)} onAdd={choices => { setProductCache(current => { const next = new Map(current); for (const choice of choices) next.set(choice.product.sku, choice.product); return next; }); change("items", [...document.items, ...choices.map(choice => choice.item)]); setProductsOpen(false); }} /> : null}
    {itemEditor ? <OrderItemDialog key={itemEditor.index ?? "new"} initial={itemEditor.item} product={productCache.get(itemEditor.item.productSku!)} currency={document.currency} onClose={() => setItemEditor(null)} onApply={item => { change("items", itemEditor.index === null ? [...document.items, item] : document.items.map((line, index) => index === itemEditor.index ? item : line)); setItemEditor(null); }} /> : null}
    <Dialog open={customerDetailsOpen} onOpenChange={setCustomerDetailsOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Customer details</DialogTitle><DialogDescription>These details are saved on this order.</DialogDescription></DialogHeader>{profile ? <PurchaseOrderProfileFields companyId={companyId} document={document} profile={profile} locked={locked} hideProfileLink={Boolean(panel)} onChange={setDocument} onRefresh={() => selectCustomer(companyId)} /> : null}<Button onClick={() => setCustomerDetailsOpen(false)}>Done</Button></DialogContent></Dialog>
    <Dialog open={shippingOpen} onOpenChange={setShippingOpen}><DialogContent><DialogHeader><DialogTitle>Shipping address</DialogTitle><DialogDescription>Delivery details for this order.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="draft-shipping-name">Recipient</Label><Input id="draft-shipping-name" value={document.shippingRecipient} maxLength={160} onChange={event => change("shippingRecipient", event.target.value)} /></div><div className="space-y-2"><Label htmlFor="draft-shipping-phone">Phone</Label><Input id="draft-shipping-phone" value={document.shippingPhone} maxLength={80} onChange={event => change("shippingPhone", event.target.value)} /></div><div className="space-y-2"><Label htmlFor="draft-shipping-address">Address</Label><Textarea id="draft-shipping-address" value={document.shippingAddress} maxLength={2000} onChange={event => change("shippingAddress", event.target.value)} /></div><Button onClick={() => setShippingOpen(false)}>Done</Button></div></DialogContent></Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}><DialogContent><DialogHeader><DialogTitle>{order ? "Discard your changes?" : "Discard this order?"}</DialogTitle><DialogDescription>{order ? "The saved order will stay unchanged." : "Your unsaved order details will be removed."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDiscardOpen(false)}>Keep editing</Button><Button variant="destructive" disabled={pending} onClick={() => { if (!pending && !saving.current) close(); }}>Discard</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function ProductCommands({ onProducts, onCustom, disabled }: { onProducts: () => void; onCustom: () => void; disabled: boolean }) {
  return <div className="flex items-center gap-2"><Button type="button" variant="secondary" size="xs" className="rounded-full" disabled={disabled} onClick={onProducts}><Plus className="size-3.5" />Product</Button><Button type="button" variant="secondary" size="xs" className="rounded-full" disabled={disabled} onClick={onCustom}><Plus className="size-3.5" />Custom item</Button></div>;
}

function OrderItemDialog({ initial, product, currency, onClose, onApply }: { initial: OrderItem; product?: InvoiceProduct; currency: string; onClose: () => void; onApply: (item: OrderItem) => void }) {
  const [item, setItem] = useState(initial);
  const shipping = item.sku === orderShippingSku && !item.productSku;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{shipping ? "Shipping / delivery" : item.productSku ? "Edit agreed price" : "Custom item"}</DialogTitle><DialogDescription>{currency} · Amounts are saved with this order.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); onApply(item.productSku && product && draftProductAvailable(item, product, currency) ? refreshOrderProductLine(item, product, item.pricingMode === "catalog") : item); }}><div className="space-y-2"><Label htmlFor="draft-item-description">Description</Label><Input id="draft-item-description" autoFocus required maxLength={500} readOnly={Boolean(item.productSku)} value={item.description} onChange={event => setItem(current => ({ ...current, description: event.target.value }))} /></div>{!shipping ? <div className="space-y-2"><Label htmlFor="draft-item-sku">SKU</Label><Input id="draft-item-sku" maxLength={200} readOnly={Boolean(item.productSku)} value={item.sku} onChange={event => setItem(current => ({ ...current, sku: event.target.value }))} /></div> : null}<div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="draft-item-qty">Quantity</Label><Input id="draft-item-qty" type="number" min={1} max={1000000} required step={1} value={Number.isNaN(item.quantity) ? "" : item.quantity} onChange={event => setItem(current => changeDraftQuantity(current, event.target.valueAsNumber, product))} /></div><div className="space-y-2"><Label htmlFor="draft-item-price">Unit price</Label><Input id="draft-item-price" type="number" min={0} max={1000000} required step="0.01" value={Number.isNaN(item.unitPriceMinor) ? "" : item.unitPriceMinor / 100} onChange={event => setItem(current => ({ ...current, unitPriceMinor: Math.round(event.target.valueAsNumber * 100), ...(current.productSku ? { pricingMode: "manual" as const } : {}) }))} /></div></div>{item.productSku ? <div className="flex flex-wrap gap-2">{product && draftProductAvailable(item, product, currency) && productUnitPrice(product, item.quantity, item.variantId) !== null ? <Button type="button" size="sm" variant="outline" onClick={() => setItem(current => refreshOrderProductLine(current, product, true))}>Use catalog price</Button> : null}<Button type="button" size="sm" variant="ghost" onClick={() => setItem(current => customOrderLine(current))}>Convert to custom item</Button></div> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Apply</Button></div></form></DialogContent></Dialog>;
}
