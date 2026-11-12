"use client";

import { useRef, useState, type MouseEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Plus, Search, X } from "lucide-react";
import { PageActions } from "@/components/page-header";
import { Checkbox } from "@/components/ui/checkbox";
import { Button, buttonVariants } from "@/components/ui/button";
import { TableStatusBadge } from "@/components/ui/table-status-badge";
import { LiveSearchForm } from "@/components/ui/live-search-form";
import { TableColumnsTrigger } from "@/components/ui/table-columns-trigger";
import { useTableColumns } from "@/components/table-columns-provider";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { purchaseOrdersHref, type PurchaseOrderFilters } from "@/lib/purchase-order-overview";
import { poStatusLabels, poStatuses } from "@/lib/purchase-orders";
import { formatMoney } from "@/lib/invoices";
import { registerDate, registerOrderDate, type PurchaseOrderRegisterRow, type RegisterBadge } from "@/lib/purchase-order-register";

type OrderSummary = { orders: number; inProduction: number; shipped: number; overdue: number };
type Column = { key: string; label: string; align?: "right" };
const orderColumns: Column[] = [
  { key: "order", label: "PO" }, { key: "customer", label: "Customer" }, { key: "date", label: "Order date" },
  { key: "orderStatus", label: "Order status" }, { key: "deliveryDate", label: "Delivery date" },
  { key: "total", label: "Total", align: "right" }, { key: "payment", label: "Payment" },
  { key: "items", label: "Quantity" }, { key: "delivery", label: "Delivery status" },
];
const draftColumns: Column[] = [
  { key: "order", label: "Draft" }, { key: "reference", label: "Customer PO" }, { key: "customer", label: "Customer" },
  { key: "date", label: "Created" }, { key: "items", label: "Quantity" }, { key: "total", label: "Total", align: "right" },
];
const CompanyPurchaseOrderCreate = dynamic(() => import("@/components/company-purchase-order-create").then(module => module.CompanyPurchaseOrderCreate));

function StatusBadge({ badge }: { badge: RegisterBadge }) {
  return <TableStatusBadge tone={badge.tone} filled={badge.filled}>{badge.label}</TableStatusBadge>;
}

function Summary({ summary, companyId }: { summary: OrderSummary; companyId?: string }) {
  const metrics = [
    { label: "All purchase orders", value: summary.orders, href: purchaseOrdersHref({}, false, companyId) },
    { label: "In production", value: summary.inProduction, href: purchaseOrdersHref({ status: "in_production" }, false, companyId) },
    { label: "Shipped", value: summary.shipped, href: purchaseOrdersHref({ status: "shipped" }, false, companyId) },
    { label: "Overdue delivery", value: summary.overdue, href: purchaseOrdersHref({ overdue: true }, false, companyId) },
  ];
  return <section aria-label="Current purchase order overview" className="po-register-summary">{metrics.map(metric => <Link key={metric.label} href={metric.href} className="po-register-metric"><p className="po-register-metric-label">{metric.label}</p><p className="po-register-metric-value">{metric.value.toLocaleString("en-US")}</p></Link>)}</section>;
}

function csvCell(value: string | number) {
  const text = String(value);
  return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}

export function PurchaseOrderRegister({ rows, filters, count, pageSize, today, drafts, canWrite, summary, company, draftCount = 0 }: {
  rows: PurchaseOrderRegisterRow[];
  filters: PurchaseOrderFilters;
  count: number;
  pageSize: number;
  today: string;
  drafts: boolean;
  canWrite: boolean;
  summary: OrderSummary | null;
  company?: { id: string; name: string };
  draftCount?: number;
}) {
  const exportColumns = drafts ? draftColumns : [orderColumns[0], { key: "reference", label: "Customer PO" }, ...orderColumns.slice(1)];
  const columns = (drafts ? draftColumns : orderColumns).filter(column => !company || column.key !== "customer");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [columnVisibility, setColumnVisibility] = useTableColumns(drafts ? "purchase-order-drafts" : "purchase-orders");
  const [createOpen, setCreateOpen] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const visibleColumns = columns.filter(column => column.key === "order" || columnVisibility[column.key] !== false);
  const selectedRows = rows.filter(row => selected.has(row.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const href = (next: Partial<PurchaseOrderFilters> = {}, draftView = drafts) => purchaseOrdersHref(next, draftView, company?.id);
  const baseHref = href();
  const filtered = Boolean(filters.search || (!drafts && filters.status) || filters.overdue);
  const filterLabel = !drafts && filters.status ? poStatusLabels[filters.status as keyof typeof poStatusLabels] : filters.overdue ? "Overdue" : "All";
  const cellText = (row: PurchaseOrderRegisterRow, key: string): string | number => {
    switch (key) {
      case "order": return row.label;
      case "reference": return row.reference;
      case "date": return drafts ? registerDate(row.createdAt, today) : registerOrderDate(row.orderDate);
      case "customer": return row.customer;
      case "deliveryDate": return row.deliveryDate ? registerOrderDate(row.deliveryDate) : "Not scheduled";
      case "total": return `${formatMoney(row.total, row.currency)} ${row.currency}`;
      case "payment": return `${row.payment.label}${row.invoiceBalance > 0 ? `; invoice balance ${formatMoney(row.invoiceBalance, row.currency)} ${row.currency}` : ""}`;
      case "orderStatus": return row.orderStatus.label;
      case "items": return `${row.itemCount.toLocaleString("en-US")} ${row.itemCount === 1 ? "unit" : "units"}`;
      case "delivery": return row.delivery?.label ?? "";
      default: return "";
    }
  };
  function exportRows() {
    const exportData = selectedRows.length ? selectedRows : rows;
    const csv = [exportColumns.map(column => csvCell(column.label)).join(","), ...exportData.map(row => exportColumns.map(column => csvCell(cellText(row, column.key))).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${drafts ? "draft-purchase-orders" : "purchase-orders"}-${today}.csv`;
    link.click(); URL.revokeObjectURL(url);
  }
  function toggleRow(id: string, checked: boolean) {
    setSelected(current => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  }
  function openCreate(event: MouseEvent<HTMLButtonElement>) {
    createTriggerRef.current = event.currentTarget;
    setDraftSaved(false);
    setCreateOpen(true);
  }
  function cell(row: PurchaseOrderRegisterRow, key: string) {
    if (key === "order") return <><Link href={`/purchase-orders/${row.id}`} className={drafts ? "po-register-draft-link" : "po-register-order-link"}>{row.label}</Link>{!drafts && row.reference ? <span className="po-register-reference" title={`Customer PO: ${row.reference}`}>{row.reference}</span> : null}</>;
    if (key === "customer") return <Link href={`/companies/${row.companyId}?tab=purchase-orders`} className="po-register-customer-link" title={row.customer}>{row.customer}</Link>;
    if (key === "date") return <time dateTime={drafts ? row.createdAt : row.orderDate}>{cellText(row, key)}</time>;
    if (key === "deliveryDate") return <span className={row.overdue ? "po-register-overdue" : undefined}>{cellText(row, key)}{row.overdue ? <small>Overdue</small> : null}</span>;
    if (key === "payment") return <><StatusBadge badge={row.payment} />{row.invoiceBalance > 0 ? <small className="po-register-invoice-balance">{formatMoney(row.invoiceBalance, row.currency)} {row.currency} invoice balance</small> : null}</>;
    if (key === "orderStatus") return <StatusBadge badge={row.orderStatus} />;
    if (key === "delivery") return row.delivery ? <StatusBadge badge={row.delivery} /> : null;
    if (key === "items") return <span>{cellText(row, key)}</span>;
    return cellText(row, key);
  }
  const actions = <>
      <Button type="button" variant="outline" size="sm" onClick={exportRows} disabled={!rows.length} title={selectedRows.length ? "Export selected orders" : "Export orders on this page"}>Export</Button>
      {canWrite ? company ? <Button type="button" size="sm" aria-haspopup="dialog" aria-expanded={createOpen} onClick={openCreate}><Plus className="size-4" />New purchase order</Button> : <Link href="/purchase-orders/new" className={buttonVariants({ size: "sm" })}><Plus className="size-4" />New purchase order</Link> : null}
    </>;
  return <div className={`po-register ${drafts ? "po-register-drafts" : "po-register-orders"}${company ? " po-register-company" : ""}`}>
    {company ? <>
      <header className="po-register-company-header"><div><h2>Purchase orders</h2><p data-no-translate>{company.name}</p></div><div className="po-register-company-actions">{actions}</div></header>
      <nav className="po-register-company-views" aria-label="Customer order views">
        <Link href={href({}, false)} aria-current={!drafts ? "page" : undefined}>Orders{summary ? <span>{summary.orders}</span> : null}</Link>
        <Link href={href({}, true)} aria-current={drafts ? "page" : undefined}>Drafts<span>{draftCount}</span></Link>
      </nav>
    </> : <PageActions>{actions}</PageActions>}
    {company && draftSaved ? <p role="status" className="mb-4 flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">Draft saved.<Link href={href({}, true)} className="font-medium underline underline-offset-4">View drafts</Link></p> : null}
    {!drafts && summary ? <Summary summary={summary} companyId={company?.id} /> : null}
    <div className="crm-table-toolbar po-register-toolbar">
      {!drafts ? <DropdownMenu><DropdownMenuTrigger className="po-register-view-trigger" aria-label="Filter orders">{filterLabel}<ChevronsUpDown className="size-3.5" /></DropdownMenuTrigger><DropdownMenuContent>
        <DropdownMenuGroup><DropdownMenuLabel>Orders</DropdownMenuLabel><DropdownMenuItem render={<Link href={href({ search: filters.search, sort: filters.sort })} />}>All</DropdownMenuItem>
          {poStatuses.filter(status => status !== "draft").map(status => <DropdownMenuItem key={status} render={<Link href={href({ search: filters.search, status, sort: filters.sort })} />}>{poStatusLabels[status]}</DropdownMenuItem>)}
        </DropdownMenuGroup>
        <DropdownMenuSeparator /><DropdownMenuItem render={<Link href={href({ search: filters.search, overdue: true, sort: filters.sort })} />}>Overdue delivery</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu> : <span className="po-register-view-label">Drafts</span>}
      <LiveSearchForm action={company ? `/companies/${encodeURIComponent(company.id)}` : baseHref} searchValue={filters.search} className="po-register-search">
        {company ? <><input type="hidden" name="tab" value="purchase-orders" />{drafts ? <input type="hidden" name="view" value="drafts" /> : null}</> : null}
        {!drafts && filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
        {filters.overdue ? <input type="hidden" name="overdue" value="1" /> : null}
        {filters.sort ? <input type="hidden" name="sort" value={filters.sort} /> : null}
        <Search className="size-4 shrink-0" aria-hidden /><input type="search" name="q" defaultValue={filters.search} maxLength={100} aria-label={company ? "Search PO number or reference" : "Search PO number or customer"} placeholder={company ? "Search PO number or reference" : "Search PO number or customer"} />
      </LiveSearchForm>
      {filtered ? <Link href={baseHref} className="po-register-clear" aria-label="Clear filters"><X className="size-3.5" /></Link> : null}
      {selectedRows.length ? <span className="po-register-selected" role="status">{selectedRows.length} selected</span> : null}
      <DropdownMenu><TableColumnsTrigger className="po-register-columns" /><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuLabel>Columns</DropdownMenuLabel>{columns.map(column => <DropdownMenuCheckboxItem key={column.key} checked={column.key === "order" || columnVisibility[column.key] !== false} disabled={column.key === "order"} closeOnClick={false} onCheckedChange={checked => setColumnVisibility(current => ({ ...current, [column.key]: checked }))}>{column.label}</DropdownMenuCheckboxItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    </div>
    <div className="crm-table-viewport" tabIndex={0} role="region" aria-label={drafts ? "Draft purchase orders" : "Purchase orders"}>
      <table className="crm-table po-register-table">
        <caption className="sr-only">{drafts ? "Draft purchase orders awaiting confirmation" : "Purchase orders, production stages, scheduled delivery, and invoice balances"}</caption>
        <thead><tr><th scope="col" className="po-register-check"><Checkbox aria-label="Select all orders on this page" checked={allSelected} indeterminate={selectedRows.length > 0 && !allSelected} disabled={!rows.length} onCheckedChange={checked => setSelected(checked ? new Set(rows.map(row => row.id)) : new Set())} /></th>{visibleColumns.map(column => <th key={column.key} scope="col" data-column={column.key} className={column.align === "right" ? "po-register-number" : undefined} aria-sort={column.key === "date" ? filters.sort === "oldest" ? "ascending" : "descending" : undefined}>{column.key === "date" ? <Link className="po-register-sort" href={href({ ...filters, sort: filters.sort === "oldest" ? undefined : "oldest", page: 1 })} aria-label={`Sort by date ${filters.sort === "oldest" ? "newest" : "oldest"} first`}>{column.label}{filters.sort === "oldest" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}</Link> : column.label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} data-selected={selected.has(row.id) || undefined} data-closed={!drafts && row.closed || undefined}>
          <td className="po-register-check"><Checkbox aria-label={`Select order ${row.label}`} checked={selected.has(row.id)} onCheckedChange={checked => toggleRow(row.id, checked)} /></td>
          {visibleColumns.map(column => <td key={column.key} data-column={column.key} className={column.align === "right" ? "po-register-number" : undefined}>{cell(row, column.key)}</td>)}
        </tr>)}</tbody>
      </table>
      {!rows.length ? <div className="po-register-empty"><h2>{filtered ? "No orders found" : drafts ? "Your drafts will appear here" : "Your orders will appear here"}</h2><p>{filtered ? "Try a different search or clear your filters." : drafts ? "Create an order and save it as a draft. When confirmed, it moves to PO." : "Confirm a draft to add it to your purchase orders."}</p>{!filtered && drafts && canWrite && company ? <button type="button" aria-haspopup="dialog" aria-expanded={createOpen} onClick={openCreate}>Create order</button> : <Link href={filtered ? baseHref : drafts && canWrite ? "/purchase-orders/new" : href({}, true)}>{filtered ? "Clear filters" : drafts && canWrite ? "Create order" : "View drafts"}</Link>}</div> : null}
    </div>
    <footer className="crm-table-pagination"><nav aria-label="Order pagination"><span className="crm-table-page-controls">{filters.page > 1 ? <Link href={href({ ...filters, page: filters.page - 1 })} aria-label="Previous page"><ChevronLeft className="size-4" /></Link> : <button type="button" disabled aria-label="Previous page"><ChevronLeft className="size-4" /></button>}<span>{count ? `${(filters.page - 1) * pageSize + 1}–${Math.min(filters.page * pageSize, count)}` : "0–0"}</span>{filters.page < pages ? <Link href={href({ ...filters, page: filters.page + 1 })} aria-label="Next page"><ChevronRight className="size-4" /></Link> : <button type="button" disabled aria-label="Next page"><ChevronRight className="size-4" /></button>}</span></nav><span>{count} {drafts ? count === 1 ? "draft" : "drafts" : count === 1 ? "order" : "orders"}</span></footer>
    {company && canWrite && createOpen ? <CompanyPurchaseOrderCreate company={company} finalFocus={createTriggerRef} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); setDraftSaved(true); }} /> : null}
  </div>;
}
