import "server-only";
import { analyticsChannelForSource, analyticsDay, type AnalyticsDashboardData, type AnalyticsSource } from "../analytics-dashboard.ts";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { getInventoryState } from "./inventory.ts";

type Relation<T> = T | T[] | null;
type CompanyRow = { id: string; name: string; created_at: string; source: string | null; pipeline: Relation<{ owner_id: string | null; next_followup_at: string | null }> };
type InvoiceRow = { id: string; company_id: string | null; number: number; status: string; currency: string; issue_date: string; due_date: string; total_minor: number; paid_minor: number };
type OrderRow = { id: string; company_id: string; order_date: string; currency: string; status: string; total_minor: number };
type CatalogRow = { id: string; company_id: string; created_at: string; currency: string; product_skus: string[] };
type EmailRow = { id: string; created_at: string; sent_at: string | null; direction: string; status: string; contacts: Relation<{ company_id: string }> };
const first = <T,>(value: Relation<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;
const currency = (value: string | null) => value?.trim() || "USD";
type PageResult = { data: unknown[] | null; error: { message: string } | null; count: number | null };

// Exported separately so the database reader can be checked without bypassing auth.
export async function readAnalyticsData(client: ReturnType<typeof createSupabaseAdmin>, viewer: { id: string }, now = new Date()): Promise<AnalyticsDashboardData> {
  const sources: AnalyticsSource[] = [];
  async function read<T>(id: AnalyticsSource["id"], label: string, page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
    try {
      const rows: T[] = [];
      for (;;) {
        const result = await page(rows.length, rows.length + 499);
        if (result.error) throw new Error(result.error.message);
        const batch = (result.data ?? []) as T[];
        rows.push(...batch);
        if (result.count !== null && rows.length >= result.count) break;
        if (!batch.length) {
          if (result.count !== null && rows.length < result.count) throw new Error("Incomplete analytics page");
          break;
        }
        if (result.count === null && batch.length < 500) break;
      }
      sources.push({ id, label, ok: true, count: rows.length });
      return rows;
    } catch (error) {
      console.error(`Analytics source unavailable: ${id}`, error instanceof Error ? error.message : "Query failed");
      sources.push({ id, label, ok: false, count: 0 });
      return [];
    }
  }
  const workspaceFlows = () => client.from("flows").select("id,name,status", { count: "exact" })
    .is("trigger_config->>flowScope", null).is("trigger_config->>scopeCompanyId", null).is("trigger_config->>scopeContactId", null);
  const [companyRows, invoiceRows, payments, orderRows, catalogRows, products, emailRows, messages, tasks, flows, runs, ai, members, inventory] = await Promise.all([
    read<CompanyRow>("companies", "Companies & follow-ups", (from, to) => client.from("companies").select("id,name,created_at,source,pipeline(owner_id,next_followup_at)", { count: "exact" }).or("source.is.null,source.neq.sample_seed").order("id").range(from, to)),
    read<InvoiceRow>("invoices", "Invoices", (from, to) => client.from("invoices").select("id,company_id,number,status,total_minor,paid_minor,currency:document->>currency,issue_date:document->>issueDate,due_date:document->>dueDate", { count: "exact" }).order("id").range(from, to)),
    read<{ id: string; invoice_id: string; paid_on: string; amount_minor: number }>("payments", "Payments", (from, to) => client.from("invoice_payments").select("id,invoice_id,paid_on,amount_minor", { count: "exact" }).order("id").range(from, to)),
    read<OrderRow>("orders", "Purchase orders", (from, to) => client.from("purchase_orders").select("id,company_id,total_minor,currency:document->>currency,status:document->>status,order_date:document->>orderDate", { count: "exact" }).order("id").range(from, to)),
    // Catalogs and AI usage are private to the signed-in teammate.
    read<CatalogRow>("catalogs", "Your catalogs", (from, to) => client.from("catalogs").select("id,company_id,created_at,currency,product_skus", { count: "exact" }).eq("user_id", viewer.id).order("id").range(from, to)),
    read<{ sku: string; name: string }>("products", "Active products", (from, to) => client.from("products").select("sku,name", { count: "exact" }).eq("active", true).not("sku", "like", "SAMPLE-%").order("sku").range(from, to)),
    read<EmailRow>("emails", "CRM outreach", (from, to) => client.from("emails").select("id,created_at,sent_at,direction,status,contacts(company_id)", { count: "exact" }).order("id").range(from, to)),
    read<{ id: string; created_at: string; direction: string; status: string }>("messages", "Messenger", (from, to) => client.from("meta_messages").select("id,created_at,direction,status", { count: "exact" }).order("id").range(from, to)),
    read<{ id: string; title: string; company_id: string | null; status: string; due_at: string | null; completed_at: string | null }>("tasks", "Your tasks", (from, to) => client.from("crm_tasks").select("id,title,company_id,status,due_at,completed_at", { count: "exact" }).eq("assigned_to", viewer.id).order("id").range(from, to)),
    read<{ id: string; name: string; status: string }>("flows", "Workspace flows", (from, to) => workspaceFlows().order("id").range(from, to)),
    read<{ id: string; flow_id: string; started_at: string; status: string }>("runs", "Workspace flow runs", (from, to) => client.from("flow_runs").select("id,flow_id,started_at,status,flows!inner(id)", { count: "exact" }).is("flows.trigger_config->>flowScope", null).is("flows.trigger_config->>scopeCompanyId", null).is("flows.trigger_config->>scopeContactId", null).order("id").range(from, to)),
    read<{ id: string; created_at: string; total_tokens: number; estimated_cost_usd: number; success: boolean }>("ai", "Your AI usage", (from, to) => client.from("ai_usage_events").select("id,created_at,total_tokens,estimated_cost_usd,success", { count: "exact" }).eq("user_id", viewer.id).order("id").range(from, to)),
    read<{ user_id: string; display_name: string | null }>("members", "Account owners", (from, to) => client.from("workspace_members").select("user_id,display_name", { count: "exact" }).order("user_id").range(from, to)),
    getInventoryState().then(({ status, snapshots }) => {
      sources.push({ id: "inventory", label: "Inventory", ok: !status.configurationError, count: snapshots.length });
      return { configured: status.configured, stale: status.stale, lastSyncedAt: status.lastSyncedAt, error: Boolean(status.lastError || status.configurationError), tracked: snapshots.length, unavailable: snapshots.filter(row => row.available <= 0).length };
    }).catch(() => {
      sources.push({ id: "inventory", label: "Inventory", ok: false, count: 0 });
      return { configured: false, stale: false, lastSyncedAt: null, error: true, tracked: 0, unavailable: 0 };
    }),
  ]);
  const companies = companyRows.map(row => {
    const pipeline = first(row.pipeline);
    return { id: row.id, name: row.name, createdAt: row.created_at, channel: analyticsChannelForSource(row.source), ownerId: pipeline?.owner_id ?? null, nextFollowupAt: pipeline?.next_followup_at ?? null };
  });
  const invoices = invoiceRows.map(row => ({ id: row.id, companyId: row.company_id, number: Number(row.number), status: row.status, currency: currency(row.currency), issueDate: row.issue_date, dueDate: row.due_date, totalMinor: Number(row.total_minor), paidMinor: Number(row.paid_minor) }));
  const orders = orderRows.map(row => ({ id: row.id, companyId: row.company_id, date: row.order_date, currency: currency(row.currency), status: row.status, totalMinor: Number(row.total_minor) }));
  const catalogs = catalogRows.map(row => ({ id: row.id, companyId: row.company_id, createdAt: row.created_at, currency: currency(row.currency), productSkus: row.product_skus ?? [] }));
  const maxDate = analyticsDay(now);
  const dates = [...companies.map(row => analyticsDay(row.createdAt)), ...invoices.map(row => row.issueDate), ...orders.map(row => row.date), ...payments.map(row => row.paid_on), ...catalogs.map(row => analyticsDay(row.createdAt)), ...emailRows.map(row => analyticsDay(row.sent_at || row.created_at)), ...messages.map(row => analyticsDay(row.created_at)), ...runs.map(row => analyticsDay(row.started_at)), ...ai.map(row => analyticsDay(row.created_at))].filter(day => day && day <= maxDate).sort();
  const currencies = [...new Set([...invoices.map(row => row.currency), ...orders.map(row => row.currency), ...catalogs.map(row => row.currency)])].sort();
  if (!currencies.length) currencies.push("USD");
  return {
    companies, invoices, orders, catalogs, products, inventory, currencies, asOf: now.toISOString(), minDate: dates[0] ?? maxDate, maxDate,
    sources: sources.sort((a, b) => a.label.localeCompare(b.label)), owners: members.map(row => ({ id: row.user_id, name: row.display_name || "Workspace member" })),
    payments: payments.map(row => ({ id: row.id, invoiceId: row.invoice_id, paidOn: row.paid_on, amountMinor: Number(row.amount_minor) })),
    emails: emailRows.map(row => ({ id: row.id, companyId: first(row.contacts)?.company_id ?? null, date: row.sent_at || row.created_at, direction: row.direction, status: row.status })),
    messages: messages.map(row => ({ id: row.id, date: row.created_at, direction: row.direction, status: row.status })),
    tasks: tasks.map(row => ({ id: row.id, title: row.title, companyId: row.company_id, status: row.status, dueAt: row.due_at, completedAt: row.completed_at })),
    flows, runs: runs.map(row => ({ id: row.id, flowId: row.flow_id, startedAt: row.started_at, status: row.status })),
    ai: ai.map(row => ({ id: row.id, date: row.created_at, tokens: Number(row.total_tokens), cost: Number(row.estimated_cost_usd), success: row.success })),
  };
}

export async function getAnalyticsDashboardData(): Promise<AnalyticsDashboardData> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return readAnalyticsData(createSupabaseAdmin(), viewer);
}
