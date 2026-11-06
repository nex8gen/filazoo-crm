import { poStatuses, type PurchaseOrderDocument } from "./purchase-orders.ts";

export const purchaseOrderPageSize = 25;
export const activeOrderStatuses = ["confirmed", "in_production", "shipped"] as const;
export type PurchaseOrderFilters = { search: string; status: string; overdue: boolean; page: number };

export function purchaseOrderFilters(params: Record<string, string | string[] | undefined>): PurchaseOrderFilters {
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const page = Number(value("page"));
  return {
    search: value("q").trim().slice(0, 100),
    status: poStatuses.find(status => status === value("status")) ?? "",
    overdue: value("overdue") === "1",
    page: Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1,
  };
}

export function purchaseOrdersHref(filters: Partial<PurchaseOrderFilters> = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.overdue) params.set("overdue", "1");
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return `/purchase-orders${params.size ? `?${params}` : ""}`;
}

export function orderIsOverdue(document: Pick<PurchaseOrderDocument, "status" | "deliveryDate">, today: string) {
  return activeOrderStatuses.some(status => status === document.status) && Boolean(document.deliveryDate) && document.deliveryDate < today;
}

/** Quote PostgREST values so a customer or PO search cannot inject filters. */
export function purchaseOrderSearchFilter(pattern: string, companyIds: string[]) {
  const quoted = pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const serial = /^%#?(\d+)%$/.exec(pattern)?.[1];
  return [`reference.ilike."${quoted}"`, ...(serial && Number.isSafeInteger(Number(serial)) ? [`number.eq.${Number(serial)}`] : []), ...(companyIds.length ? [`company_id.in.(${companyIds.join(",")})`] : [])].join(",");
}
