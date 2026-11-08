import { analyticsDay } from "./analytics-dashboard.ts";
import type { HomeInputs, HomeRange, HomeReport, HomeTrendPoint } from "./home.ts";

export const homeMetricIds = ["newCompanies", "orders", "sales", "averageOrderValue", "conversionRate", "emailsSent", "wonCustomers"] as const;
export type HomeMetricId = typeof homeMetricIds[number];
export const defaultHomeMetrics: HomeMetricId[] = ["newCompanies", "orders", "sales", "averageOrderValue"];
export type HomeValuePoint = Omit<HomeTrendPoint, "current" | "previous"> & { current: number | null; previous: number | null };
export type HomeSalesReport = {
  currencies: string[]; defaultCurrency: string;
  byCurrency: Record<string, { current: { sales: number; average: number | null }; previous: { sales: number; average: number | null }; salesTrend: HomeValuePoint[]; averageTrend: HomeValuePoint[] }>;
  conversion: { current: number | null; previous: number | null; trend: HomeValuePoint[] };
};

export function normalizeHomeMetrics(value: unknown): HomeMetricId[] {
  if (!Array.isArray(value) || value.length !== 4 || new Set(value).size !== 4 || value.some(id => !homeMetricIds.includes(id))) return [...defaultHomeMetrics];
  return [...value] as HomeMetricId[];
}

export function replaceHomeMetric(current: HomeMetricId[], index: number, next: HomeMetricId): HomeMetricId[] {
  const result = normalizeHomeMetrics(current);
  if (!Number.isInteger(index) || index < 0 || index > 3 || !homeMetricIds.includes(next)) return result;
  const existing = result.indexOf(next);
  if (existing >= 0) result[existing] = result[index];
  result[index] = next;
  return result;
}

export function buildHomeSales(input: HomeInputs, range: HomeRange, previousRange: HomeRange, points: HomeTrendPoint[], bucketDays: number): HomeSalesReport {
  const companyIds = new Set(input.companies.map(row => row.id));
  const orders = input.orders.filter(row => companyIds.has(row.companyId) && !["draft", "cancelled"].includes(row.status));
  const currencies = [...new Set(orders.map(row => row.currency).filter(value => /^[A-Z]{3}$/.test(value)))].sort();
  if (!currencies.length) currencies.push("USD");
  const inRange = (value: string, selected: HomeRange) => { const day = analyticsDay(value); return day >= selected.from && day <= selected.to; };
  const selectedOrders = orders.filter(row => inRange(row.date, range)), previousOrders = orders.filter(row => inRange(row.date, previousRange));
  const bucket = (value: string, start: string) => Math.floor(Math.round((Date.parse(analyticsDay(value)) - Date.parse(start)) / 86400000) / bucketDays);
  const byCurrency: HomeSalesReport["byCurrency"] = {};
  for (const currency of currencies) {
    const compute = (rows: typeof orders, selected: HomeRange) => {
      const matching = rows.filter(row => row.currency === currency);
      const buckets = points.map(() => ({ sales: 0, orders: 0 }));
      for (const order of matching) { const entry = buckets[bucket(order.date, selected.from)]; if (entry) { entry.sales += order.totalMinor; entry.orders++; } }
      const sales = matching.reduce((total, row) => total + row.totalMinor, 0);
      return { sales, average: matching.length ? sales / matching.length : null, buckets };
    };
    const current = compute(selectedOrders, range), previous = compute(previousOrders, previousRange);
    byCurrency[currency] = {
      current: { sales: current.sales, average: current.average }, previous: { sales: previous.sales, average: previous.average },
      salesTrend: points.map((point, index) => ({ ...point, current: current.buckets[index].sales, previous: previous.buckets[index].sales })),
      averageTrend: points.map((point, index) => ({ ...point, current: current.buckets[index].orders ? current.buckets[index].sales / current.buckets[index].orders : null, previous: previous.buckets[index].orders ? previous.buckets[index].sales / previous.buckets[index].orders : null })),
    };
  }
  // A conversion is a unique new lead with a confirmed order in the same reporting period.
  const conversion = (selected: HomeRange, rows: typeof orders) => {
    const leads = input.companies.filter(row => inRange(row.createdAt, selected));
    const leadDates = new Map(leads.map(row => [row.id, analyticsDay(row.createdAt)]));
    const converted = new Set(rows.filter(row => leadDates.has(row.companyId) && analyticsDay(row.date) >= leadDates.get(row.companyId)!).map(row => row.companyId));
    const buckets = points.map(() => ({ leads: 0, converted: 0 }));
    for (const lead of leads) { const entry = buckets[bucket(lead.createdAt, selected.from)]; if (entry) { entry.leads++; if (converted.has(lead.id)) entry.converted++; } }
    return { rate: leads.length ? converted.size / leads.length * 100 : null, buckets: buckets.map(entry => entry.leads ? entry.converted / entry.leads * 100 : null) };
  };
  const current = conversion(range, selectedOrders), previous = conversion(previousRange, previousOrders);
  return { currencies, defaultCurrency: currencies.includes("USD") ? "USD" : currencies[0], byCurrency,
    conversion: { current: current.rate, previous: previous.rate, trend: points.map((point, index) => ({ ...point, current: current.buckets[index], previous: previous.buckets[index] })) } };
}

export function homeMetricValue(report: HomeReport, id: HomeMetricId, currency: string): { current: number | null; previous: number | null; points: HomeValuePoint[] | null } {
  const commerce = report.sales.byCurrency[currency] ?? report.sales.byCurrency[report.sales.defaultCurrency];
  if (id === "sales") return { current: commerce.current.sales, previous: commerce.previous.sales, points: commerce.salesTrend };
  if (id === "averageOrderValue") return { current: commerce.current.average, previous: commerce.previous.average, points: commerce.averageTrend };
  if (id === "conversionRate") return { current: report.sales.conversion.current, previous: report.sales.conversion.previous, points: report.sales.conversion.trend };
  if (id === "wonCustomers") return { current: report.metrics.wonCustomers, previous: null, points: null };
  return { current: report.metrics[id], previous: report.previousMetrics[id], points: report.trends[id] };
}
