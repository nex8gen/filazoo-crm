import { notFound, redirect } from "next/navigation";
import { PurchaseOrderRegister } from "@/components/purchase-order-register";
import { getPurchaseOrder, listPurchaseOrders, purchaseOrderOverview } from "@/lib/data/purchase-orders";
import { purchaseOrderFilters, purchaseOrderPageSize, purchaseOrdersHref, type PurchaseOrderFilters } from "@/lib/purchase-order-overview";
import { purchaseOrderRegisterRow } from "@/lib/purchase-order-register";
import "@/app/purchase-orders/purchase-orders.css";

export async function CompanyPurchaseOrders({ companyId, companyName, canWrite, orderId, params = {}, filters: initialFilters, drafts: initialDrafts }: {
  companyId: string;
  companyName: string;
  canWrite: boolean;
  orderId?: string;
  params?: Record<string, string | string[] | undefined>;
  filters?: PurchaseOrderFilters;
  drafts?: boolean;
}) {
  // Saved search and activity links still target the former company inline editor.
  if (orderId) {
    const order = await getPurchaseOrder(orderId);
    if (!order || order.company_id !== companyId) notFound();
    redirect(`/purchase-orders/${order.id}`);
  }
  const requested = initialFilters ?? purchaseOrderFilters(params);
  const drafts = initialDrafts ?? (params.view === "drafts" || requested.status === "draft");
  const filters = drafts ? { ...requested, status: "draft", overdue: false } : requested;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const [{ orders, count }, overview] = await Promise.all([
    listPurchaseOrders(filters, today, companyId),
    purchaseOrderOverview(today, companyId),
  ]);
  const pages = Math.max(1, Math.ceil(count / purchaseOrderPageSize));
  if (filters.page > pages) redirect(purchaseOrdersHref({ ...filters, page: pages }, drafts, companyId));
  const summary = {
    orders: Object.entries(overview.stages).reduce((sum, [status, value]) => sum + (status === "draft" ? 0 : value), 0),
    inProduction: overview.stages.in_production, shipped: overview.stages.shipped, overdue: overview.overdue,
  };
  return <PurchaseOrderRegister key={JSON.stringify(filters)} company={{ id: companyId, name: companyName }} draftCount={overview.stages.draft}
    rows={orders.map(order => purchaseOrderRegisterRow(order, today))} filters={filters} count={count} pageSize={purchaseOrderPageSize}
    today={today} drafts={drafts} canWrite={canWrite} summary={summary} />;
}
