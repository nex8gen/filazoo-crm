import { responsePresentationSchema, type ResponsePresentation, type ResponseSection } from "./response-presentation.ts";

export type RecordEvidence = { resource: string; records: unknown[]; coverage?: { matching?: number | null; nextOffset?: number | null; scope?: string }; query?: string };
type RecordRow = Record<string, unknown>;
const object = (value: unknown): RecordRow => value && typeof value === "object" && !Array.isArray(value) ? value as RecordRow : {};
const text = (value: unknown, max = 200) => typeof value === "string" ? value.slice(0, max) : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const names: Record<ResponseSection["id"], string> = { invoices: "Invoices reviewed", orders: "Orders reviewed", quotations: "Quotations reviewed", companies: "Customers reviewed", tasks: "Your tasks", products: "Products reviewed", inventory: "Saved inventory", segments: "Customer segments" };

function money(minor: number | undefined, currency: string) {
  if (minor === undefined || !/^[A-Z]{3}$/.test(currency)) return "Unknown";
  return `${currency} ${new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}
function date(value: unknown) {
  const source = text(value);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(source) ? source : /^\d{4}-\d{2}-\d{2}T/.test(source) && Number.isFinite(Date.parse(source)) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(source)) : "";
  return day && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day ? day : "";
}
function label(value: string) { return value ? value.replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase()) : "Unknown"; }
function tone(status: string): ResponseSection["rows"][number]["tone"] {
  if (/overdue|out of stock|unavailable/i.test(status)) return "danger";
  if (/paid|completed|accepted|in stock/i.test(status)) return "success";
  if (/due today|partial|low stock|expired/i.test(status)) return "warning";
  return "neutral";
}
function countChart(rows: ResponseSection["rows"], key: string, title: string): ResponseSection["chart"] {
  const counts = new Map<string, number>();
  for (const row of rows) { const value = String(row.cells[key] || "Unknown"); counts.set(value, (counts.get(value) ?? 0) + 1); }
  // Never drop categories silently or invent a trend from a single snapshot.
  if (counts.size < 2 || counts.size > 20) return undefined;
  return { kind: "bar", title, unit: "records", points: [...counts].map(([label, value]) => ({ label: label.slice(0, 120), value })) };
}
function recordLink(resource: ResponseSection["id"], id: string) {
  if (resource === "tasks") return "/tasks";
  if (resource === "products") return `/products/${encodeURIComponent(id)}`;
  const root = { invoices: "invoices", orders: "purchase-orders", quotations: "company-quotations", companies: "companies" }[resource as "invoices"];
  return root && uuid.test(id) ? `/${root}/${id}` : undefined;
}

/** Values and charts come only from completed permission-scoped reads, never model prose. */
export function buildRecordPresentation(evidence: readonly RecordEvidence[], userText: string, now = new Date()): ResponsePresentation | undefined {
  const today = date(now.toISOString());
  const groups = new Map<ResponseSection["id"], RecordEvidence[]>();
  for (const item of evidence) {
    if (!Object.hasOwn(names, item.resource)) continue;
    const id = item.resource as ResponseSection["id"];
    groups.set(id, [...groups.get(id) ?? [], item]);
  }
  const companyNames = new Map<string, string>();
  for (const item of evidence.filter(item => item.resource === "companies")) for (const value of item.records) {
    const row = object(value), fields = object(row.fields);
    const name = text(row.name) || text(fields.name);
    if (name) companyNames.set(text(row.id), name);
  }
  const request = userText.toLowerCase();
  const signals: Record<ResponseSection["id"], RegExp> = {
    invoices: /invoice|payment|unpaid|overdue|发票|付款/, orders: /order|purchase|订单|采购/, quotations: /quot|catalog|报价/,
    companies: /customer|compan|follow.?up|audience|客户|公司|跟进/, tasks: /task|plan my day|follow.?up|任务|今日|跟进/,
    products: /product|stock|inventory|产品|库存/, inventory: /stock|inventory|库存/, segments: /segment|campaign|audience|受众|营销|分群/,
  };
  const sorted = [...groups].sort(([a], [b]) => Number(signals[b].test(request)) - Number(signals[a].test(request)));
  const sections: ResponseSection[] = [];
  for (const [resource, reads] of sorted.slice(0, 3)) {
    // A supporting company/product read is not itself an analysis report when another resource is requested.
    if (sections.length && !signals[resource].test(request)) continue;
    const records = new Map<string, RecordRow>();
    for (const read of reads) for (const value of read.records) {
      const row = object(value), id = text(row.id, 200) || text(row.sku, 200);
      if (id) records.set(id, row);
    }
    const entries = [...records].slice(0, 50);
    const maxMatching = Math.max(...reads.map(read => read.coverage?.matching ?? 0), 0);
    const limited = records.size > entries.length || maxMatching > records.size || reads.some(read => read.coverage?.nextOffset != null && maxMatching === 0);
    const filters = new Set(reads.map(read => read.query ?? ""));
    const scope = [...new Set(reads.map(read => read.coverage?.scope).filter(Boolean))].join(" ");
    const description = `${entries.length} saved ${entries.length === 1 ? "record" : "records"} reviewed. ${limited || filters.size > 1 ? "Partial view of the records checked; totals and charts cover only this view." : "Totals and charts cover these records only."}${scope ? ` ${scope}` : ""}`.slice(0, 600);
    const rows: ResponseSection["rows"] = [];
    let columns: ResponseSection["columns"] = [];
    const metrics: ResponseSection["metrics"] = [];
    const totals = new Map<string, number>();
    for (const [id, row] of entries) {
      const document = object(row.document ?? row.quote_document), fields = object(row.fields);
      const company = text(document.customerName) || text(object(document.customer).companyName) || companyNames.get(text(row.company_id)) || "Customer not loaded";
      let title = "", subtitle = "", status = "", cells: ResponseSection["rows"][number]["cells"] = {};
      if (resource === "invoices") {
        columns = [{ key: "reference", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "status", label: "Status" }, { key: "due", label: "Due date" }, { key: "days", label: "Days overdue" }, { key: "balance", label: "Balance" }];
        title = number(row.number) !== undefined ? `#${row.number}` : "Invoice"; subtitle = company;
        const total = number(row.total_minor), paid = number(row.paid_minor), currency = text(document.currency), due = date(document.dueDate);
        const remaining = total !== undefined && paid !== undefined ? Math.max(0, total - paid) : undefined;
        const savedStatus = text(row.status);
        status = savedStatus === "issued" ? remaining === 0 ? "Paid" : !due || remaining === undefined ? "Issued · details missing" : due < today ? "Overdue" : paid && paid > 0 ? "Partially paid" : "Issued" : label(savedStatus);
        const days = status === "Overdue" ? Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000) : null;
        cells = { reference: title, customer: company, status, due: due || "Not set", days, balance: money(remaining, currency) };
        if (savedStatus === "issued" && remaining !== undefined && remaining > 0 && /^[A-Z]{3}$/.test(currency)) totals.set(currency, (totals.get(currency) ?? 0) + remaining);
      } else if (resource === "orders" || resource === "quotations") {
        const isQuote = resource === "quotations", currency = text(document.currency) || text(row.currency);
        title = text(row.reference) || text(document.reference) || (isQuote ? `Quotation${number(row.version) !== undefined ? ` v${row.version}` : ""}` : "Purchase order"); subtitle = company;
        status = label(text(isQuote ? row.quote_status : document.status));
        if (isQuote && status === "Shared" && date(document.validUntil) && date(document.validUntil) < today) status = "Expired";
        const total = number(row.total_minor) ?? number(document.totalMinor);
        columns = [{ key: "reference", label: isQuote ? "Quotation" : "Order" }, { key: "customer", label: "Customer" }, { key: "status", label: "Status" }, { key: "date", label: isQuote ? "Issued" : "Order date" }, { key: "total", label: "Value" }];
        cells = { reference: title, customer: company, status, date: date(isQuote ? document.issueDate : document.orderDate) || "Not set", total: money(total, currency) };
        if (!isQuote && ["confirmed", "in_production", "shipped", "completed"].includes(text(document.status)) && total !== undefined && /^[A-Z]{3}$/.test(currency)) totals.set(currency, (totals.get(currency) ?? 0) + total);
      } else if (resource === "companies") {
        title = text(row.name) || text(fields.name) || "Customer"; subtitle = [text(row.city ?? fields.city), text(row.country ?? fields.country)].filter(Boolean).join(", ");
        const account = object(Array.isArray(row.account) ? row.account[0] : row.account);
        const followup = date(account.next_followup_at ?? fields.nextFollowupAt);
        status = followup ? followup < today ? "Overdue follow-up" : followup === today ? "Due today" : "Upcoming follow-up" : "No follow-up date";
        columns = [{ key: "name", label: "Customer" }, { key: "country", label: "Country" }, { key: "segment", label: "Segment" }, { key: "followup", label: "Follow-up" }, { key: "status", label: "Status" }];
        cells = { name: title, country: text(row.country ?? fields.country) || "Not set", segment: text(row.segment ?? fields.segment) || "Not set", followup: followup || "Not set", status };
      } else if (resource === "tasks") {
        title = text(row.title) || "Task"; subtitle = companyNames.get(text(row.company_id)) || "Assigned to you";
        const due = date(row.due_at), saved = text(row.status);
        status = ["completed", "cancelled"].includes(saved) ? label(saved) : due && due < today ? "Overdue" : due === today ? "Due today" : label(saved);
        columns = [{ key: "title", label: "Task" }, { key: "status", label: "Status" }, { key: "priority", label: "Priority" }, { key: "due", label: "Due date" }];
        cells = { title, status, priority: label(text(row.priority)), due: due || "Not set" };
      } else if (resource === "products") {
        title = text(row.name) || id; subtitle = id; status = text(row.stock_status, 80) || "Stock not recorded";
        columns = [{ key: "sku", label: "SKU" }, { key: "name", label: "Product" }, { key: "stock", label: "Saved stock label" }, { key: "leadTime", label: "Lead time" }];
        cells = { sku: id, name: title, stock: status, leadTime: text(row.lead_time) || "Not set" };
      } else if (resource === "inventory") {
        title = text(row.sku) || id; subtitle = "Saved ERP snapshot";
        const syncedAt = text(row.synced_at ?? row.updated_at), timestamp = Date.parse(syncedAt);
        status = !Number.isFinite(timestamp) ? "Snapshot age unknown" : now.getTime() - timestamp > 30 * 60_000 ? "Stale snapshot" : "Saved snapshot";
        columns = [{ key: "sku", label: "SKU" }, { key: "quantity", label: "Saved available quantity" }, { key: "updated", label: "Snapshot date" }];
        cells = { sku: title, quantity: number(row.available) ?? null, updated: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "Unknown" };
      } else {
        title = text(row.name) || "Segment"; subtitle = text(row.description, 240); status = "Saved segment";
        columns = [{ key: "name", label: "Segment" }, { key: "description", label: "Description" }]; cells = { name: title, description: subtitle };
      }
      rows.push({ id, title, subtitle, status, tone: tone(status), cells, ...(recordLink(resource, id) ? { href: recordLink(resource, id) } : {}) });
    }
    // Empty lookups retain the same explicit columns as populated lists.
    if (!columns.length) columns = [{ key: "name", label: "Record" }];
    metrics.push({ label: "Records reviewed", value: String(rows.length), tone: "neutral" });
    if (resource === "invoices") {
      metrics.push({ label: "Overdue", value: String(rows.filter(row => row.status === "Overdue").length), tone: "danger" });
      metrics.push({ label: "Drafts excluded from overdue", value: String(rows.filter(row => row.status === "Draft").length), tone: "neutral" });
    }
    for (const [currency, total] of [...totals].slice(0, 5)) metrics.push({ label: resource === "invoices" ? "Issued balance" : "Confirmed order value", value: money(total, currency), tone: "neutral" });
    let chart = countChart(rows, resource === "companies" ? "country" : resource === "products" ? "stock" : "status", resource === "companies" ? "Customers by country" : resource === "products" ? "Saved stock labels" : "Records by status");
    if (resource === "orders" && totals.size === 1 && /trend|over time|sales|revenue|chart|graph|趋势|营收/.test(request)) {
      const currency = [...totals.keys()][0], days = new Map<string, number>();
      for (const [, row] of entries) {
        const document = object(row.document), day = date(document.orderDate), total = number(row.total_minor) ?? number(document.totalMinor);
        if (day && total !== undefined && total >= 0 && document.currency === currency && ["confirmed", "in_production", "shipped", "completed"].includes(text(document.status))) days.set(day, (days.get(day) ?? 0) + total);
      }
      if (days.size >= 2 && days.size <= 20) chart = { kind: "line", title: "Confirmed order value by date", unit: currency, points: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value: value / 100 })) };
    }
    const emptyMessage = "No records were returned for this lookup. This does not establish that there are no other accessible records.";
    sections.push({ id: resource, title: names[resource], description, columns, rows, metrics, chart, emptyMessage });
  }
  if (!sections.length) return undefined;
  const result = responsePresentationSchema.safeParse({ version: 1, capturedAt: now.toISOString(), sections });
  return result.success ? result.data : undefined;
}
