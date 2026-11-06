import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { poStatuses, purchaseOrderSchema, type PurchaseOrder, type PurchaseOrderActivity } from "../purchase-orders";
import { activeOrderStatuses, purchaseOrderPageSize, purchaseOrderSearchFilter, type PurchaseOrderFilters } from "../purchase-order-overview";

const orderSelect = "id,number,company_id,version,document,total_minor,created_at,updated_at,company:companies(name,country),invoices:invoices!invoices_purchase_order_id_fkey(id,number,status,total_minor,paid_minor,document,order_managed,last_sent_at)";
export type PurchaseOrderRow = PurchaseOrder & { companyName: string; country: string };

function parseOrder(row: Record<string, unknown>): PurchaseOrderRow {
  const company = row.company as { name: string; country?: string } | null;
  const document = purchaseOrderSchema.parse(row.document);
  return { ...row, document, companyName: company?.name || document.customer?.companyName || "Unknown company", country: company?.country || "" } as PurchaseOrderRow;
}

export async function getPurchaseOrder(id: string) {
  const { data, error } = await createSupabaseAdmin().from("purchase_orders").select(orderSelect).eq("id", id).maybeSingle();
  if (error) throw new Error("The purchase order could not be loaded. Please try again.");
  return data ? parseOrder(data) : null;
}

export async function getPurchaseOrderActivity(id: string, companyId: string): Promise<PurchaseOrderActivity[]> {
  const { data, error } = await createSupabaseAdmin().from("events")
    .select("id,created_at,type,data").eq("company_id", companyId).contains("data", { purchaseOrderId: id })
    .order("created_at", { ascending: false }).order("id").limit(30);
  if (error) throw new Error("Order activity could not be loaded.");
  return (data ?? []).map(event => ({
    id: event.id, createdAt: event.created_at, type: event.type,
    summary: typeof event.data?.summary === "string" ? event.data.summary : "Order updated",
  }));
}

export async function purchaseOrderOverview(today: string) {
  const db = createSupabaseAdmin();
  const [stages, overdue] = await Promise.all([
    Promise.all(poStatuses.map(async status => {
      const { count, error } = await db.from("purchase_orders").select("id", { count: "exact", head: true }).eq("document->>status", status);
      if (error) throw new Error("Order totals could not be loaded.");
      return [status, count ?? 0] as const;
    })),
    db.from("purchase_orders").select("id", { count: "exact", head: true })
      .in("document->>status", [...activeOrderStatuses]).neq("document->>deliveryDate", "").lt("document->>deliveryDate", today),
  ]);
  if (overdue.error) throw new Error("Delivery totals could not be loaded.");
  return { stages: Object.fromEntries(stages) as Record<(typeof poStatuses)[number], number>, overdue: overdue.count ?? 0 };
}

export async function listPurchaseOrders(filters: PurchaseOrderFilters, today: string) {
  const db = createSupabaseAdmin();
  let query = db.from("purchase_orders").select(orderSelect, { count: "exact" });
  if (filters.status) query = query.eq("document->>status", filters.status);
  if (filters.overdue) query = query.in("document->>status", [...activeOrderStatuses]).neq("document->>deliveryDate", "").lt("document->>deliveryDate", today);
  if (filters.search) {
    const pattern = `%${filters.search.replace(/[\\%_]/g, "")}%`;
    const companyIds: string[] = [];
    // Resolve current company names as well as PO references, including legacy POs without a customer snapshot.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from("companies").select("id").ilike("name", pattern).order("id").range(offset, offset + 499);
      if (error) throw new Error("Customer search could not be loaded.");
      companyIds.push(...(data ?? []).map(company => company.id));
      if ((data?.length ?? 0) < 500) break;
    }
    query = query.or(purchaseOrderSearchFilter(pattern, companyIds));
  }
  const start = (filters.page - 1) * purchaseOrderPageSize;
  const { data, count, error } = await query.order("created_at", { ascending: false }).order("id").range(start, start + purchaseOrderPageSize - 1);
  if (error) throw new Error("Purchase orders could not be loaded. Please try again.");
  return { orders: (data ?? []).map(parseOrder), count: count ?? 0 };
}
