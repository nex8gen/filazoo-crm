export type CompanyOrderInvoice = {
  id: string;
  company_id: string | null;
  purchase_order_id: string | null;
  status: string;
  total_minor: number;
  paid_minor: number;
};

/** One order per fully paid invoice, deduplicating split invoices for a saved PO. */
export function companyPaidOrderCounts(invoices: readonly CompanyOrderInvoice[]) {
  const orders = new Map<string, Set<string>>();
  for (const invoice of invoices) {
    if (!invoice.company_id || invoice.status !== "issued" || invoice.total_minor <= 0 || invoice.paid_minor < invoice.total_minor) continue;
    let companyOrders = orders.get(invoice.company_id);
    if (!companyOrders) orders.set(invoice.company_id, companyOrders = new Set());
    companyOrders.add(invoice.purchase_order_id ? `order:${invoice.purchase_order_id}` : `invoice:${invoice.id}`);
  }
  return new Map([...orders].map(([id, ids]) => [id, ids.size]));
}

export function companyOrderBadge(count: number) {
  const orders = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return {
    tier: orders === 0 ? "black" : orders === 1 ? "bronze" : orders === 2 ? "silver" : "gold",
    text: orders === 0 ? "" : orders > 3 ? "3+" : String(orders),
    label: `${orders} paid ${orders === 1 ? "order" : "orders"}`,
  } as const;
}
