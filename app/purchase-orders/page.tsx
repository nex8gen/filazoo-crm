import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardList, Factory, PackageCheck, Plus, Search, Truck, TriangleAlert } from "lucide-react";
import { requireWorkspaceMember } from "@/lib/auth";
import { listPurchaseOrders, purchaseOrderOverview } from "@/lib/data/purchase-orders";
import { orderBillingSummary, poStatuses, poStatusLabels, purchaseOrderLabel } from "@/lib/purchase-orders";
import { orderIsOverdue, purchaseOrderFilters, purchaseOrderPageSize, purchaseOrdersHref } from "@/lib/purchase-order-overview";
import { formatMoney } from "@/lib/invoices";
import { PageActions } from "@/components/page-header";
import { PurchaseOrderStatus } from "@/components/purchase-order-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Purchase orders" };

export default async function PurchaseOrdersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = await searchParams;
  const filters = purchaseOrderFilters(params);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const [{ orders, count }, overview] = await Promise.all([listPurchaseOrders(filters, today), purchaseOrderOverview(today)]);
  const pages = Math.max(1, Math.ceil(count / purchaseOrderPageSize));
  if (filters.page > pages) redirect(purchaseOrdersHref({ ...filters, page: pages }));
  const allCount = Object.values(overview.stages).reduce((sum, count) => sum + count, 0);
  const hasFilters = Boolean(filters.search || filters.status || filters.overdue);
  const metrics = [
    { label: "All orders", value: allCount, description: "Customer purchase orders received", icon: ClipboardList, href: "/purchase-orders", tone: "text-foreground" },
    { label: "In production", value: overview.stages.in_production, description: "Being prepared for shipment", icon: Factory, href: purchaseOrdersHref({ status: "in_production" }), tone: "text-amber-700 dark:text-amber-300" },
    { label: "Shipped", value: overview.stages.shipped, description: "On the way to the customer", icon: Truck, href: purchaseOrdersHref({ status: "shipped" }), tone: "text-violet-700 dark:text-violet-300" },
    { label: "Overdue delivery", value: overview.overdue, description: "Past the scheduled delivery date", icon: TriangleAlert, href: purchaseOrdersHref({ overdue: true }), tone: overview.overdue ? "text-destructive" : "text-muted-foreground" },
  ];
  return <div className="space-y-5 pb-6">
    <PageActions>{viewer.role !== "viewer" ? <Link href="/purchase-orders/new" className={buttonVariants({ size: "sm" })}><Plus className="size-4" />New purchase order</Link> : null}</PageActions>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(metric => <Link key={metric.label} href={metric.href} className="group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{metric.label}</span><metric.icon className={`size-4 ${metric.tone}`} aria-hidden /></div>
        <div className={`mt-3 text-3xl font-semibold tabular-nums tracking-tight ${metric.tone}`}>{metric.value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{metric.description}</p>
      </Link>)}
    </div>
    <section aria-label="Purchase order register" className="overflow-hidden rounded-xl border bg-card">
      <nav aria-label="Order stages" className="flex gap-1 overflow-x-auto border-b px-3 pt-2">
        {[{ status: "", label: "All orders", count: allCount }, ...poStatuses.map(status => ({ status, label: poStatusLabels[status], count: overview.stages[status] }))].map(stage => <Link key={stage.status} href={purchaseOrdersHref({ ...filters, status: stage.status, page: 1 })} aria-current={filters.status === stage.status ? "page" : undefined} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${filters.status === stage.status ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{stage.label}<span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">{stage.count}</span></Link>)}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <form action="/purchase-orders" method="get" className="flex w-full max-w-lg items-center gap-2">
          {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
          {filters.overdue ? <input type="hidden" name="overdue" value="1" /> : null}
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden /><Input key={filters.search} name="q" defaultValue={filters.search} maxLength={100} aria-label="Search PO number or customer" placeholder="Search PO number or customer..." className="pl-9" /></div>
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <div className="flex items-center gap-3 text-xs">
          <Link href={purchaseOrdersHref({ ...filters, overdue: !filters.overdue, page: 1 })} aria-current={filters.overdue ? "page" : undefined} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 ${filters.overdue ? "border-destructive/30 bg-destructive/5 text-destructive" : "text-muted-foreground hover:bg-muted"}`}><TriangleAlert className="size-3.5" />Overdue delivery</Link>
          {hasFilters ? <Link href="/purchase-orders" className="text-muted-foreground underline underline-offset-4">Clear filters</Link> : null}
        </div>
      </div>
      {orders.length ? <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm">
        <caption className="sr-only">Customer purchase orders with delivery dates, order values and invoice balances</caption>
        <thead className="border-b bg-muted/25 text-xs text-muted-foreground"><tr>{["Purchase order", "Customer", "Status", "Delivery", "Order total", "Billing", ""].map((title, index) => <th key={index} scope="col" className={`px-4 py-3 font-medium ${title === "Order total" ? "text-right" : ""}`}>{title || <span className="sr-only">Open order</span>}</th>)}</tr></thead>
        <tbody className="divide-y">{orders.map(order => {
          const billing = orderBillingSummary(order);
          const overdue = orderIsOverdue(order.document, today);
          const reserved = order.invoices?.some(invoice => invoice.status === "draft");
          return <tr key={order.id} className="hover:bg-muted/20">
            <td className="px-4 py-4"><Link href={`/purchase-orders/${order.id}`} className="font-medium hover:text-primary hover:underline">{purchaseOrderLabel(order)}</Link>{purchaseOrderLabel(order) !== order.document.reference ? <p className="mt-1 text-xs text-muted-foreground">{order.document.reference}</p> : null}<p className="mt-1 text-xs text-muted-foreground">{order.document.orderDate} · {order.document.items.length} {order.document.items.length === 1 ? "line item" : "line items"}</p></td>
            <td className="max-w-56 px-4 py-4"><Link href={`/companies/${order.company_id}?tab=purchase-orders`} className="line-clamp-2 hover:text-primary hover:underline">{order.companyName}</Link></td>
            <td className="px-4 py-4"><PurchaseOrderStatus status={order.document.status} /></td>
            <td className="whitespace-nowrap px-4 py-4"><span className={overdue ? "font-medium text-destructive" : ""}>{order.document.deliveryDate || "Not scheduled"}</span>{overdue ? <p className="mt-1 flex items-center gap-1 text-xs text-destructive"><TriangleAlert className="size-3" />Overdue</p> : null}</td>
            <td className="whitespace-nowrap px-4 py-4 text-right font-medium tabular-nums"><span className="mr-1 text-xs font-normal text-muted-foreground">{order.document.currency}</span>{formatMoney(order.total_minor, order.document.currency)}</td>
            <td className="whitespace-nowrap px-4 py-4"><p className={billing.outstanding > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>{billing.total > 0 ? billing.outstanding > 0 ? `${formatMoney(billing.outstanding, order.document.currency)} due` : "Paid" : reserved ? "Draft invoice" : "Not invoiced"}</p><p className="mt-1 text-xs text-muted-foreground">{billing.fullyInvoiced ? "Fully invoiced" : billing.total > 0 ? "Partially invoiced" : ""}</p></td>
            <td className="px-4 py-4"><Link href={`/purchase-orders/${order.id}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`Open order ${purchaseOrderLabel(order)}`}><ArrowRight className="size-4" /></Link></td>
          </tr>;
        })}</tbody>
      </table></div> : <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center"><div className="rounded-2xl bg-muted p-4"><PackageCheck className="size-7 text-muted-foreground" /></div><h3 className="font-semibold">{hasFilters ? "No matching purchase orders" : "Your purchase orders start here"}</h3><p className="max-w-md text-sm text-muted-foreground">{hasFilters ? "Try another PO number or customer, or clear the filters to see all orders." : "Record a customer PO, connect its products, and follow it through production, invoicing, and delivery."}</p><Link href={hasFilters ? "/purchase-orders" : viewer.role !== "viewer" ? "/purchase-orders/new" : "/companies"} className={buttonVariants({ variant: "outline", size: "sm" })}>{hasFilters ? "Clear filters" : viewer.role !== "viewer" ? "New purchase order" : "View companies"}</Link></div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground"><span>{count ? `${(filters.page - 1) * purchaseOrderPageSize + 1}–${Math.min(filters.page * purchaseOrderPageSize, count)} of ${count} orders` : "0 orders"}</span><nav aria-label="Order pagination" className="flex items-center gap-3">{filters.page > 1 ? <Link href={purchaseOrdersHref({ ...filters, page: filters.page - 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>Previous</Link> : <Button variant="outline" size="sm" disabled>Previous</Button>}<span>Page {filters.page} of {pages}</span>{filters.page < pages ? <Link href={purchaseOrdersHref({ ...filters, page: filters.page + 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>Next</Link> : <Button variant="outline" size="sm" disabled>Next</Button>}</nav></div>
    </section>
  </div>;
}
