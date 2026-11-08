import { redirect } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/auth";
import { listPurchaseOrders, purchaseOrderOverview } from "@/lib/data/purchase-orders";
import { purchaseOrderFilters, purchaseOrderPageSize, purchaseOrdersHref } from "@/lib/purchase-order-overview";
import { purchaseOrderRegisterRow } from "@/lib/purchase-order-register";
import { PurchaseOrderRegister } from "@/components/purchase-order-register";
import "./purchase-orders.css";

export type PurchaseOrderPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function PurchaseOrdersView({ searchParams, drafts = false }: PurchaseOrderPageProps & { drafts?: boolean }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = await searchParams;
  const requested = purchaseOrderFilters(params);
  if (!drafts && requested.status === "draft") redirect(purchaseOrdersHref({ ...requested, status: "", overdue: false }, true));
  const filters = drafts ? { ...requested, status: "draft", overdue: false } : requested;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const [{ orders, count }, overview] = await Promise.all([
    listPurchaseOrders(filters, today),
    drafts ? Promise.resolve(null) : purchaseOrderOverview(today),
  ]);
  const pages = Math.max(1, Math.ceil(count / purchaseOrderPageSize));
  if (filters.page > pages) redirect(purchaseOrdersHref({ ...filters, page: pages }, drafts));
  const summary = overview ? {
    orders: Object.entries(overview.stages).reduce((sum, [status, value]) => sum + (status === "draft" ? 0 : value), 0),
    inProduction: overview.stages.in_production, shipped: overview.stages.shipped, overdue: overview.overdue,
  } : null;
  return <PurchaseOrderRegister key={JSON.stringify(filters)} rows={orders.map(order => purchaseOrderRegisterRow(order, today))} filters={filters} count={count} pageSize={purchaseOrderPageSize} today={today} drafts={drafts} canWrite={viewer.role !== "viewer"} summary={summary} />;
}
