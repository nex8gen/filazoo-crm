import "server-only";
import { analyticsChannelForSource, analyticsDay, type AnalyticsDashboardData, type AnalyticsSource } from "../analytics-dashboard.ts";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";

type Relation<T> = T | T[] | null;
type CompanyRow = { id: string; name: string; created_at: string; source: string | null; pipeline: Relation<{ owner_id: string | null }> };
type InvoiceRow = { id: string; company_id: string | null; number: number; status: string; currency: string; issue_date: string; due_date: string; total_minor: number; paid_minor: number };
type OrderRow = { id: string; company_id: string; order_date: string; currency: string; status: string; total_minor: number };
type CatalogRow = { id: string; company_id: string; created_at: string; currency: string; product_skus: string[] };
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
  const [companyRows, invoiceRows, payments, orderRows, catalogRows, products, members] = await Promise.all([
    read<CompanyRow>("companies", "Companies", (from, to) => client.from("companies").select("id,name,created_at,source,pipeline(owner_id)", { count: "exact" }).or("source.is.null,source.neq.sample_seed").order("id").range(from, to)),
    read<InvoiceRow>("invoices", "Invoices", (from, to) => client.from("invoices").select("id,company_id,number,status,total_minor,paid_minor,currency:document->>currency,issue_date:document->>issueDate,due_date:document->>dueDate", { count: "exact" }).order("id").range(from, to)),
    read<{ id: string; invoice_id: string; paid_on: string; amount_minor: number }>("payments", "Payments", (from, to) => client.from("invoice_payments").select("id,invoice_id,paid_on,amount_minor", { count: "exact" }).order("id").range(from, to)),
    read<OrderRow>("orders", "Purchase orders", (from, to) => client.from("purchase_orders").select("id,company_id,total_minor,currency:document->>currency,status:document->>status,order_date:document->>orderDate", { count: "exact" }).order("id").range(from, to)),
    // Catalogs are private to the signed-in teammate.
    read<CatalogRow>("catalogs", "Your catalogs", (from, to) => client.from("catalogs").select("id,company_id,created_at,currency,product_skus", { count: "exact" }).eq("user_id", viewer.id).order("id").range(from, to)),
    read<{ sku: string; name: string }>("products", "Active products", (from, to) => client.from("products").select("sku,name", { count: "exact" }).eq("active", true).not("sku", "like", "SAMPLE-%").order("sku").range(from, to)),
    read<{ user_id: string; display_name: string | null }>("members", "Account owners", (from, to) => client.from("workspace_members").select("user_id,display_name", { count: "exact" }).order("user_id").range(from, to)),
  ]);
  const companies = companyRows.map(row => {
    const pipeline = first(row.pipeline);
    return { id: row.id, name: row.name, createdAt: row.created_at, channel: analyticsChannelForSource(row.source), ownerId: pipeline?.owner_id ?? null };
  });
  const invoices = invoiceRows.map(row => ({ id: row.id, companyId: row.company_id, number: Number(row.number), status: row.status, currency: currency(row.currency), issueDate: row.issue_date, dueDate: row.due_date, totalMinor: Number(row.total_minor), paidMinor: Number(row.paid_minor) }));
  const orders = orderRows.map(row => ({ id: row.id, companyId: row.company_id, date: row.order_date, currency: currency(row.currency), status: row.status, totalMinor: Number(row.total_minor) }));
  const catalogs = catalogRows.map(row => ({ id: row.id, companyId: row.company_id, createdAt: row.created_at, currency: currency(row.currency), productSkus: row.product_skus ?? [] }));
  const maxDate = analyticsDay(now);
  const dates = [...companies.map(row => analyticsDay(row.createdAt)), ...invoices.map(row => row.issueDate), ...orders.map(row => row.date), ...payments.map(row => row.paid_on), ...catalogs.map(row => analyticsDay(row.createdAt))].filter(day => day && day <= maxDate).sort();
  const currencies = [...new Set([...invoices.map(row => row.currency), ...orders.map(row => row.currency), ...catalogs.map(row => row.currency)])].sort();
  if (!currencies.length) currencies.push("USD");
  return {
    companies, invoices, orders, catalogs, products, currencies, asOf: now.toISOString(), minDate: dates[0] ?? maxDate, maxDate,
    sources: sources.sort((a, b) => a.label.localeCompare(b.label)), owners: members.map(row => ({ id: row.user_id, name: row.display_name || "Workspace member" })),
    payments: payments.map(row => ({ id: row.id, invoiceId: row.invoice_id, paidOn: row.paid_on, amountMinor: Number(row.amount_minor) })),
  };
}

export async function getAnalyticsDashboardData(): Promise<AnalyticsDashboardData> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return readAnalyticsData(createSupabaseAdmin(), viewer);
}
