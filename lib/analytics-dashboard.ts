export const analyticsChannels = ["meta", "store", "partner", "direct", "mixed", "other"] as const;
export type AnalyticsChannel = typeof analyticsChannels[number];
export const channelLabels: Record<AnalyticsChannel, string> = { meta: "Meta", store: "Shopify", partner: "Partner / referral", direct: "Direct / email", mixed: "Multiple sources", other: "Unattributed" };
export type AnalyticsCompany = { id: string; name: string; createdAt: string; channel: AnalyticsChannel; ownerId: string | null; nextFollowupAt: string | null };
export type AnalyticsInvoice = { id: string; companyId: string | null; number: number; status: string; currency: string; issueDate: string; dueDate: string; totalMinor: number; paidMinor: number };
export type AnalyticsInputs = {
  companies: AnalyticsCompany[];
  invoices: AnalyticsInvoice[];
  payments: { id: string; invoiceId: string; paidOn: string; amountMinor: number }[];
  orders: { id: string; companyId: string; date: string; currency: string; status: string; totalMinor: number }[];
  catalogs: { id: string; companyId: string; createdAt: string; currency: string; productSkus: string[] }[];
  products: { sku: string; name: string }[];
  emails: { id: string; companyId: string | null; date: string; direction: string; status: string }[];
  messages: { id: string; date: string; direction: string; status: string }[];
  tasks: { id: string; title: string; companyId: string | null; status: string; dueAt: string | null; completedAt: string | null }[];
  flows: { id: string; name: string; status: string }[];
  runs: { id: string; flowId: string; startedAt: string; status: string }[];
  ai: { id: string; date: string; tokens: number; cost: number; success: boolean }[];
  inventory: { configured: boolean; stale: boolean; lastSyncedAt: string | null; error: boolean; tracked: number; unavailable: number };
};
export type AnalyticsSource = { id: keyof AnalyticsInputs | "members"; label: string; ok: boolean; count: number };
export type AnalyticsDashboardData = AnalyticsInputs & { sources: AnalyticsSource[]; currencies: string[]; owners: { id: string; name: string }[]; minDate: string; maxDate: string; asOf: string };
export type AnalyticsFiltersValue = { from: string; to: string; channel: AnalyticsChannel | "all"; owner: string; currency: string; comparison: "previous_period" | "previous_year" | "none" };

export function analyticsChannelForSource(source: string | null | undefined): AnalyticsChannel {
  const value = source?.trim().toLowerCase() ?? "";
  if (value.includes("+")) return "mixed";
  if (/meta|facebook|instagram|messenger/.test(value)) return "meta";
  if (/shopify|store/.test(value)) return "store";
  if (/partner|referral|reseller|wholesale/.test(value)) return "partner";
  if (/manual|direct|email/.test(value)) return "direct";
  return "other";
}
// Use one business timezone so every teammate sees the same totals.
export function analyticsDay(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function previousRange(filters: Pick<AnalyticsFiltersValue, "from" | "to" | "comparison">) {
  if (filters.comparison === "previous_year") {
    const previousYear = (day: string) => {
      const date = new Date(`${day}T00:00:00Z`), month = date.getUTCMonth();
      date.setUTCFullYear(date.getUTCFullYear() - 1);
      if (date.getUTCMonth() !== month) date.setUTCDate(0);
      return date.toISOString().slice(0, 10);
    };
    return { from: previousYear(filters.from), to: previousYear(filters.to) };
  }
  const days = Math.round((Date.parse(filters.to) - Date.parse(filters.from)) / 86400000) + 1;
  return { from: shiftDay(filters.from, -days), to: shiftDay(filters.from, -1) };
}
const sum = <T,>(rows: T[], field: (row: T) => number) => rows.reduce((total, row) => total + field(row), 0);
const inRange = (value: string, range: { from: string; to: string }) => { const day = analyticsDay(value); return Boolean(day && day >= range.from && day <= range.to); };

export function computeAnalytics(data: AnalyticsDashboardData, filters: AnalyticsFiltersValue) {
  const companyMap = new Map(data.companies.map(row => [row.id, row]));
  const matching = data.companies.filter(row => (filters.channel === "all" || row.channel === filters.channel) && (filters.owner === "all" || (filters.owner === "unassigned" ? !row.ownerId : row.ownerId === filters.owner)));
  const companyIds = new Set(matching.map(row => row.id));
  const scoped = filters.channel !== "all" || filters.owner !== "all";
  const matchesCompany = (id: string | null) => id ? companyIds.has(id) : !scoped;
  const invoices = data.invoices.filter(row => matchesCompany(row.companyId) && row.currency === filters.currency);
  const invoiceMap = new Map(invoices.map(row => [row.id, row]));
  const issued = invoices.filter(row => row.status === "issued");
  const receivables = issued.filter(row => row.totalMinor > row.paidMinor);
  const overdueInvoices = receivables.filter(row => row.dueDate && row.dueDate < data.maxDate);
  const orders = data.orders.filter(row => matchesCompany(row.companyId) && row.currency === filters.currency && !["draft", "cancelled"].includes(row.status));
  const period = (range: { from: string; to: string }) => {
    const companies = matching.filter(row => inRange(row.createdAt, range));
    const periodInvoices = issued.filter(row => inRange(row.issueDate, range));
    const payments = data.payments.filter(row => invoiceMap.get(row.invoiceId)?.status === "issued" && inRange(row.paidOn, range));
    const periodOrders = orders.filter(row => inRange(row.date, range));
    const catalogs = data.catalogs.filter(row => matchesCompany(row.companyId) && row.currency === filters.currency && inRange(row.createdAt, range));
    const emails = data.emails.filter(row => matchesCompany(row.companyId) && inRange(row.date, range));
    const runs = data.runs.filter(row => inRange(row.startedAt, range));
    const messages = data.messages.filter(row => inRange(row.date, range));
    const ai = data.ai.filter(row => inRange(row.date, range));
    return { companies, periodInvoices, payments, periodOrders, catalogs, emails, runs, messages, ai,
      newCompanies: companies.length, invoiced: sum(periodInvoices, row => row.totalMinor), collected: sum(payments, row => row.amountMinor),
      orderValue: sum(periodOrders, row => row.totalMinor) };
  };
  const current = period(filters), previous = period(previousRange(filters));
  const channels = analyticsChannels.map(channel => {
    const rows = current.companies.filter(row => row.channel === channel);
    return { channel, count: rows.length };
  });
  const productNames = new Map(data.products.map(row => [row.sku, row.name]));
  const productCounts = new Map<string, number>();
  for (const catalog of current.catalogs) for (const sku of new Set(catalog.productSkus)) productCounts.set(sku, (productCounts.get(sku) ?? 0) + 1);
  const topProducts = [...productCounts].map(([sku, count]) => ({ sku, name: productNames.get(sku) ?? sku, count })).sort((a, b) => b.count - a.count || a.sku.localeCompare(b.sku)).slice(0, 5);
  const days = Math.round((Date.parse(filters.to) - Date.parse(filters.from)) / 86400000) + 1;
  const bucketSize = Math.max(1, Math.ceil(days / 90));
  const series = Array.from({ length: Math.ceil(days / bucketSize) }, (_, index) => ({ date: shiftDay(filters.from, index * bucketSize), companies: 0, collected: 0 }));
  const bucket = (date: string) => Math.floor(Math.round((Date.parse(analyticsDay(date)) - Date.parse(filters.from)) / 86400000) / bucketSize);
  for (const row of current.companies) { const point = series[bucket(row.createdAt)]; if (point) point.companies++; }
  for (const row of current.payments) { const point = series[bucket(row.paidOn)]; if (point) point.collected += row.amountMinor / 100; }
  const openTasks = data.tasks.filter(row => row.status === "open");
  const overdueTasks = openTasks.filter(row => row.dueAt && Date.parse(row.dueAt) < Date.parse(data.asOf)).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
  const followups = matching.filter(row => row.nextFollowupAt && Date.parse(row.nextFollowupAt) < Date.parse(data.asOf));
  const flowRows = data.flows.map(flow => ({ ...flow, active: data.runs.filter(row => row.flowId === flow.id && row.status === "active").length, failed: current.runs.filter(row => row.flowId === flow.id && row.status === "failed").length, done: current.runs.filter(row => row.flowId === flow.id && row.status === "done").length }));
  return { current, previous, channels, series, topProducts, receivables, overdueInvoices,
    outstanding: sum(receivables, row => row.totalMinor - row.paidMinor), overdue: sum(overdueInvoices, row => row.totalMinor - row.paidMinor),
    openTasks, overdueTasks, followups, flowRows, companyMap,
    completedTasks: data.tasks.filter(row => row.status === "done" && row.completedAt && inRange(row.completedAt, filters)).length };
}
export function analyticsChange(current: number, previous: number): number | null {
  return previous === 0 ? (current === 0 ? 0 : null) : ((current - previous) / Math.abs(previous)) * 100;
}
export function analyticsCsv(rows: (string | number)[][]) {
  return "\uFEFF" + rows.map(row => row.map(value => {
    const text = String(value), safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}
