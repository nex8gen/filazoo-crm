import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CheckCircle2, Globe2, Package2 } from "lucide-react";
import { PurchaseOrderStatus } from "@/components/purchase-order-status";
import { orderBillingSummary, purchaseOrderLabel, type OrderCustomer, type PurchaseOrder, type PurchaseOrderActivity } from "@/lib/purchase-orders";
import { draftPaymentTotals, orderShippingSku } from "@/lib/purchase-order-draft";
import { orderDisplayDate } from "@/lib/purchase-order-summary";
import { formatMoney, invoiceLabel } from "@/lib/invoices";
import { purchaseOrderAmounts } from "@/lib/purchase-order-billing";

export function PurchaseOrderSummary({ order, companyName, country, customer, activity, activityError, invoiceAction, invoiceSection, paymentDetails }: {
  order: PurchaseOrder;
  companyName: string;
  country: string;
  customer?: OrderCustomer;
  activity: PurchaseOrderActivity[];
  activityError?: boolean;
  invoiceAction?: ReactNode;
  invoiceSection?: ReactNode;
  paymentDetails?: ReactNode;
}) {
  const po = order.document;
  const totals = draftPaymentTotals(po.items);
  const amounts = purchaseOrderAmounts(po);
  const billing = orderBillingSummary(order);
  const hasIssuedInvoices = order.invoices?.some(invoice => invoice.status === "issued");
  const updated = order.updated_at && order.updated_at !== order.created_at;
  const history = activity.length ? activity : [{ id: order.id, createdAt: order.created_at, type: "purchase_order_created", summary: "Order created" }];
  return <div className="mx-auto max-w-[1100px] pb-12 pt-3">
    <Link href={po.status === "draft" ? "/purchase-orders/drafts" : "/purchase-orders"} className="mb-5 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{po.status === "draft" ? "Drafts" : "PO"}</Link>
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
      <div className="min-w-0 space-y-8">
        <header><div className="flex flex-wrap items-center gap-3"><h2 className="text-2xl font-medium tracking-tight">{purchaseOrderLabel(order)}</h2><PurchaseOrderStatus status={po.status} /></div><p className="mt-2 text-xs text-muted-foreground">{updated ? "Updated" : "Created"} {orderDisplayDate(updated ? order.updated_at! : order.created_at, true)}</p></header>
        {po.status === "completed" ? <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="size-4 shrink-0" />Order completed</div> : null}
        <section aria-labelledby="saved-po-products" className="space-y-4"><h3 id="saved-po-products" className="text-sm font-medium">Products</h3><div className="divide-y rounded-2xl border bg-card px-4 shadow-sm">{po.items.map((item, index) => item.sku === orderShippingSku && !item.productSku ? null : <div key={index} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 py-4 sm:grid-cols-[40px_minmax(0,1fr)_80px_50px_90px]">
          {item.imageUrl ? <Image src={item.imageUrl} alt="" width={40} height={40} unoptimized className="size-10 rounded-lg border object-cover" /> : <div className="grid size-10 place-items-center rounded-lg border bg-muted"><Package2 className="size-4 text-muted-foreground" /></div>}
          <div className="min-w-0"><p className="text-sm font-medium leading-5">{item.description}</p>{item.sku ? <p className="mt-1 text-xs text-muted-foreground">{item.sku}</p> : null}</div>
          <span className="hidden text-right text-sm tabular-nums sm:block">{formatMoney(item.unitPriceMinor, po.currency)}</span><span className="hidden whitespace-nowrap text-center text-xs text-muted-foreground sm:block">× {item.quantity}</span><div className="text-right text-sm tabular-nums"><span>{formatMoney(item.quantity * item.unitPriceMinor, po.currency)}</span><p className="mt-1 text-xs text-muted-foreground sm:hidden">{item.quantity} × {formatMoney(item.unitPriceMinor, po.currency)}</p></div>
        </div>)}</div></section>
        <section aria-labelledby="saved-po-payment" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 id="saved-po-payment" className="text-sm font-medium">Payment</h3>{invoiceAction}</div><div className="overflow-hidden rounded-2xl border bg-card shadow-sm"><dl className="space-y-4 p-4 text-sm"><div className="flex items-center justify-between gap-3"><dt>Subtotal <span className="ml-2 text-xs text-muted-foreground">{totals.quantity} items</span></dt><dd className="tabular-nums">{formatMoney(totals.subtotal, po.currency)}</dd></div><div className="flex items-center justify-between gap-3"><dt>Shipping</dt><dd className="tabular-nums">{formatMoney(totals.shipping, po.currency)}</dd></div><div className="flex items-center justify-between gap-3"><dt>Discount</dt><dd className="tabular-nums">{formatMoney(po.billing?.discountMinor || 0, po.currency)}</dd></div><div className="flex items-center justify-between gap-3"><dt>Tax</dt><dd className="tabular-nums">{formatMoney(amounts.tax, po.currency)}</dd></div><div className="flex items-center justify-between gap-3 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(order.total_minor, po.currency)} <span className="text-xs">{po.currency}</span></dd></div>{hasIssuedInvoices ? <><div className="flex items-center justify-between gap-3 border-t pt-4"><dt>Received</dt><dd className="tabular-nums">{formatMoney(billing.paid, po.currency)}</dd></div><div className="flex items-center justify-between gap-3"><dt>Invoice balance</dt><dd className="tabular-nums">{formatMoney(billing.outstanding, po.currency)}</dd></div></> : null}</dl>
          {!invoiceSection && order.invoices?.length ? <div className="space-y-3 border-t px-4 py-3">{order.invoices.map(invoice => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><Link href={`/invoices/${invoice.id}`} className="text-primary hover:underline">{invoiceLabel(invoice)}</Link><span className="ml-auto capitalize text-muted-foreground">{invoice.status}</span><span className="tabular-nums">{formatMoney(invoice.total_minor, po.currency)}</span></div>)}</div> : null}
        {paymentDetails}</div></section>
        {invoiceSection}
        <section aria-labelledby="saved-po-timeline" className="space-y-4"><h3 id="saved-po-timeline" className="text-sm font-medium">Timeline</h3>{activityError ? <p className="text-xs text-muted-foreground">Order activity could not be loaded.</p> : <ol className="ml-2 border-l pl-5">{history.map(event => <li key={event.id} className="relative pb-5 last:pb-0"><span aria-hidden className="absolute top-1 -left-[25px] size-2 rounded-full bg-muted-foreground ring-4 ring-background" /><div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><p className="text-sm">{event.type === "purchase_order_created" ? "Order created" : event.type === "purchase_order_updated" ? "Order updated" : event.summary}</p><time dateTime={event.createdAt} className="text-xs text-muted-foreground">{orderDisplayDate(event.createdAt, true)}</time></div></li>)}</ol>}</section>
      </div>
      <aside aria-label="Order customer and details" className="min-w-0 divide-y lg:pt-1">
        <section className="space-y-3 pb-5"><h3 className="text-sm font-medium">Customer</h3><Link href={`/companies/${order.company_id}`} className="block text-sm font-medium text-primary hover:underline">{customer?.companyName || companyName}</Link>{customer?.contactName ? <p className="text-sm">{customer.contactName}</p> : null}{customer?.contactEmail ? <p className="break-all text-sm text-primary">{customer.contactEmail}</p> : null}</section>
        <section className="space-y-3 py-5"><h3 className="text-sm font-medium">Shipping address</h3><div className="space-y-1 text-sm leading-6">{po.shippingRecipient ? <p>{po.shippingRecipient}</p> : null}<p className={`whitespace-pre-line ${!po.shippingAddress ? "text-muted-foreground" : ""}`}>{po.shippingAddress || "No shipping address"}</p>{po.shippingPhone ? <p>{po.shippingPhone}</p> : null}</div></section>
        <section className="space-y-3 py-5"><h3 className="text-sm font-medium">Billing address</h3><p className={`whitespace-pre-line text-sm leading-6 ${!customer?.billingAddress ? "text-muted-foreground" : ""}`}>{customer?.billingAddress && customer.billingAddress.trim() === po.shippingAddress.trim() ? "Same as shipping address" : customer?.billingAddress || "No billing address"}</p>{customer?.billingEmail && customer.billingEmail !== customer.contactEmail ? <p className="break-all text-xs text-muted-foreground">{customer.billingEmail}</p> : null}</section>
        <section className="space-y-4 py-5">{country ? <><h3 className="text-sm font-medium">Markets</h3><span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs"><Globe2 className="size-3.5" />{country}</span></> : null}<div className="space-y-2"><h3 className="text-xs text-muted-foreground">Currency</h3><p className="rounded-lg border bg-muted/15 px-3 py-2 text-sm text-muted-foreground">{po.currency}</p></div></section>
        {po.deliveryDate || po.reference !== purchaseOrderLabel(order) ? <section className="space-y-3 py-5">{po.deliveryDate ? <div><p className="text-xs text-muted-foreground">Expected delivery</p><p className="mt-1 text-sm">{orderDisplayDate(po.deliveryDate)}</p></div> : null}{po.reference !== purchaseOrderLabel(order) ? <div><p className="text-xs text-muted-foreground">Customer PO reference</p><p className="mt-1 break-words text-sm">{po.reference}</p></div> : null}</section> : null}
        {po.notes ? <section className="space-y-3 py-5"><h3 className="text-sm font-medium">Notes</h3><p className="whitespace-pre-wrap break-words text-sm leading-6">{po.notes}</p></section> : null}
        {po.tags?.length ? <section className="space-y-3 py-5"><h3 className="text-sm font-medium">Tags</h3><div className="flex flex-wrap gap-2">{[...new Set(po.tags)].map(tag => <span key={tag} className="rounded-full bg-muted px-2.5 py-1 text-xs">{tag}</span>)}</div></section> : null}
      </aside>
    </div>
  </div>;
}
