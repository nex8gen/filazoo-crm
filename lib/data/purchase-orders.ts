import "server-only";
import { z } from "zod";
import { createSupabaseAdmin } from "../supabase/admin";
import { poStatuses, purchaseOrderSchema, type PurchaseOrder, type PurchaseOrderActivity } from "../purchase-orders";
import { activeOrderStatuses, purchaseOrderPageSize, purchaseOrderSearchFilter, type PurchaseOrderFilters } from "../purchase-order-overview";

const orderSelect = "id,number,company_id,version,document,total_minor,created_at,updated_at,company:companies(name,country),invoices:invoices!invoices_purchase_order_id_fkey(id,number,status,total_minor,paid_minor,document,order_managed,last_sent_at)";
export type PurchaseOrderShipment = {
  invoice_id: string;
  status: string;
  tracking_number: string;
  expected_delivery: string;
  updated_at: string;
};
export type PurchaseOrderRow = PurchaseOrder & { companyName: string; country: string; shipments?: PurchaseOrderShipment[] };

async function loadOrderShipments(db: ReturnType<typeof createSupabaseAdmin>, invoiceIds: string[]) {
  const shipments: PurchaseOrderShipment[] = [];
  const uniqueIds = [...new Set(invoiceIds)];
  // Bound URL length and keep one lookup per batch rather than one per order.
  for (let offset = 0; offset < uniqueIds.length; offset += 200) {
    const { data, error } = await db.from("customer_portal_shipments")
      .select("invoice_id,status,tracking_number,expected_delivery,updated_at")
      .in("invoice_id", uniqueIds.slice(offset, offset + 200));
    if (error) throw new Error("Order delivery details could not be loaded.");
    shipments.push(...(data ?? []) as PurchaseOrderShipment[]);
  }
  return shipments;
}

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

export async function purchaseOrderOverview(today: string, companyId?: string) {
  if (companyId !== undefined) z.uuid().parse(companyId);
  const db = createSupabaseAdmin();
  const countOrders = () => {
    let query = db.from("purchase_orders").select("id", { count: "exact", head: true });
    if (companyId !== undefined) query = query.eq("company_id", companyId);
    return query;
  };
  const [stages, overdue] = await Promise.all([
    Promise.all(poStatuses.map(async status => {
      const { count, error } = await countOrders().eq("document->>status", status);
      if (error) throw new Error("Order totals could not be loaded.");
      return [status, count ?? 0] as const;
    })),
    countOrders()
      .in("document->>status", [...activeOrderStatuses]).neq("document->>deliveryDate", "").lt("document->>deliveryDate", today),
  ]);
  if (overdue.error) throw new Error("Delivery totals could not be loaded.");
  return { stages: Object.fromEntries(stages) as Record<(typeof poStatuses)[number], number>, overdue: overdue.count ?? 0 };
}

export async function listPurchaseOrders(filters: PurchaseOrderFilters, today: string, companyId?: string) {
  if (companyId !== undefined) z.uuid().parse(companyId);
  const db = createSupabaseAdmin();
  let query = db.from("purchase_orders").select(orderSelect, { count: "exact" });
  if (companyId !== undefined) query = query.eq("company_id", companyId);
  if (filters.status) query = query.eq("document->>status", filters.status);
  else query = query.neq("document->>status", "draft");
  if (filters.overdue) query = query.in("document->>status", [...activeOrderStatuses]).neq("document->>deliveryDate", "").lt("document->>deliveryDate", today);
  if (filters.search) {
    const pattern = `%${filters.search.replace(/[\\%_]/g, "")}%`;
    const companyIds: string[] = [];
    // A company profile already fixes the customer; search its PO references and numbers only.
    if (companyId === undefined) {
      // Include legacy POs without a customer snapshot in global customer-name searches.
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await db.from("companies").select("id").ilike("name", pattern).order("id").range(offset, offset + 499);
        if (error) throw new Error("Customer search could not be loaded.");
        companyIds.push(...(data ?? []).map(company => company.id));
        if ((data?.length ?? 0) < 500) break;
      }
    }
    query = query.or(purchaseOrderSearchFilter(pattern, companyIds));
  }
  const start = (filters.page - 1) * purchaseOrderPageSize;
  const ascending = filters.sort === "oldest";
  // Confirmed orders follow the customer's order date; drafts follow creation.
  if (filters.status !== "draft") query = query.order("document->>orderDate", { ascending });
  const { data, count, error } = await query.order("created_at", { ascending }).order("id").range(start, start + purchaseOrderPageSize - 1);
  if (error) throw new Error("Purchase orders could not be loaded. Please try again.");
  const orders = (data ?? []).map(parseOrder);
  const shipments = await loadOrderShipments(db, orders.flatMap(order => (order.invoices ?? []).filter(invoice => invoice.status === "issued").map(invoice => invoice.id)));
  const shipmentMap = new Map(shipments.map(shipment => [shipment.invoice_id, shipment]));
  return { orders: orders.map(order => ({ ...order, shipments: (order.invoices ?? []).flatMap(invoice => shipmentMap.has(invoice.id) ? [shipmentMap.get(invoice.id)!] : []) })), count: count ?? 0 };
}
