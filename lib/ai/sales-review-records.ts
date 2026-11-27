import "server-only";
import type { WorkspaceViewer } from "../auth";
import type { AiPolicy } from "../ai-policy";
import { requireAiData } from "../data/ai-settings";
import { createSupabaseAdmin } from "../supabase/admin";
import type { SalesReviewRange } from "./sales-review.ts";

type Row = Record<string, unknown>;
type Source = { records: Row[]; coverage: { available: boolean; included: number; truncated: boolean; scope: string } };
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown, max = 180) => typeof value === "string" ? value.slice(0, max) : "";
const relation = (value: unknown) => object(Array.isArray(value) ? value[0] : value);

/** All queries stay inside workspaceFetch and use an ownership join for every non-admin. */
export async function readSalesReview(viewer: WorkspaceViewer, period: SalesReviewRange, policy: AiPolicy, signal: AbortSignal) {
  policy = await requireAiData("customers");
  const db = createSupabaseAdmin();
  const customer = viewer.role === "admin" ? "company:companies!inner(id,name)" : "company:companies!inner(id,name,pipeline!inner(owner_id))";
  const limit = 50;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  async function read(table: string, fields: string, scope: string, privateOwner?: string): Promise<Source> {
    try {
      let query = db.from(table).select(`${fields},${customer}`);
      if (viewer.role !== "admin") query = query.eq("company.pipeline.owner_id", viewer.id);
      if (privateOwner) query = query.eq(privateOwner, viewer.id);
      query = query.gte("created_at", period.since).lte("created_at", period.until);
      const { data, error } = await query.order("created_at", { ascending: false }).order("id").limit(limit + 1).abortSignal(deadline);
      if (error) throw new Error("Source unavailable");
      return { records: (data ?? []).slice(0, limit).map(value => {
        const row = object(value), company = relation(row.company), doc = object(row.document ?? row.quote_document);
        const kind = table === "catalogs" ? "company-quotations" : table === "purchase_orders" ? "purchase-orders" : table;
        const href = ["catalogs", "purchase_orders", "invoices"].includes(table) ? `/${kind}/${row.id}` : `/companies/${company.id}`;
        // Never forward raw document JSON or arbitrary event data/provider payloads.
        return { id: row.id, companyId: company.id, company: company.name, href, createdAt: row.created_at,
          ...(table === "events" ? { type: row.type } : {}),
          ...(table === "crm_tasks" ? { title: row.title, status: row.status, dueAt: row.due_at, completedAt: row.completed_at, priority: row.priority } : {}),
          ...(table !== "events" && table !== "crm_tasks" ? { reference: row.reference ?? row.number ?? doc.reference, status: row.status ?? row.quote_status ?? doc.status,
            currency: row.currency ?? doc.currency, totalMinor: row.total_minor, paidMinor: row.paid_minor,
            dueDate: doc.dueDate, validUntil: doc.validUntil, note: text(doc.notes, 240),
            items: (Array.isArray(doc.items) ? doc.items : []).slice(0, 5).map(value => { const item = object(value); return { sku: item.productSku ?? item.sku, quantity: item.quantity }; }) } : {}) };
      }), coverage: { available: true, included: Math.min(data?.length ?? 0, limit), truncated: (data?.length ?? 0) > limit, scope } };
    } catch { return { records: [], coverage: { available: false, included: 0, truncated: false, scope } }; }
  }
  const unavailable = (scope: string): Source => ({ records: [], coverage: { available: false, included: 0, truncated: false, scope } });
  const [events, orders, quotations, invoices, tasks] = await Promise.all([
    policy.data.tasks ? read("events", "id,type,created_at", "Recent customer-linked audit event types; note bodies excluded") : unavailable("Activity data disabled"),
    policy.data.billing ? read("purchase_orders", "id,reference,document,total_minor,created_at", "Orders created in the period; current snapshot") : unavailable("Billing data disabled"),
    policy.data.billing && policy.data.products ? read("catalogs", "id,currency,quote_status,quote_document,created_at", "Your quotations created in the period; current snapshot", "user_id") : unavailable("Quotation data disabled"),
    policy.data.billing ? read("invoices", "id,number,status,document,total_minor,paid_minor,created_at", "Invoices created in the period; current snapshot") : unavailable("Billing data disabled"),
    policy.data.tasks ? read("crm_tasks", "id,title,status,due_at,completed_at,priority,created_at", "Your customer-linked tasks created in the period", "assigned_to") : unavailable("Task data disabled"),
  ]);
  signal.throwIfAborted();
  return { period, scope: viewer.role === "admin" ? "Current workspace customers; quotations and tasks remain user-scoped" : "Only customers currently assigned to the signed-in user; quotations and tasks remain user-scoped",
    sources: { events, orders, quotations, invoices, tasks },
    coverage: { maximumRowsPerSource: limit, externalMailboxHistoryScanned: false, historicalStatusTransitionsComplete: false,
      note: "Creation-date window plus audit events, not exhaustive conversion/payment history. Old records updated in this period may be omitted. Disabled, timed-out and failed sources are unavailable, not empty." } };
}
