import { analyticsDay, shiftDay } from "./analytics-dashboard.ts";
import { buildHomeSales, type HomeSalesReport } from "./home-metrics.ts";

export type HomePeriod = "today" | "month" | "all";
export type HomeCompany = { id: string; ownerId: string | null; stage: string; createdAt: string };
export type HomeEmail = { ownerId: string | null; sentAt: string };
export type HomeOrder = { companyId: string; date: string; status: string; currency: string; totalMinor: number };
export type HomeMember = { id: string; name: string; role: string; avatarUrl?: string };
export type HomeInputs = { companies: HomeCompany[]; emails: HomeEmail[]; orders: HomeOrder[]; members: HomeMember[] };
export type HomeMetrics = { newCompanies: number; emailsSent: number; orders: number; wonCustomers: number; openOpportunities: number; orderValues: { currency: string; minor: number }[] };
export type HomePerformance = HomeMember & { emailsSent: number; wonCustomers: number; orders: number; customers: number; newCustomers: number; orderValues: HomeMetrics["orderValues"] };
export type HomeRange = { from: string; to: string };
export type HomeTrendMetric = "newCompanies" | "emailsSent" | "orders";
export type HomeTrendPoint = { date: string; previousDate: string; current: number; previous: number };
export type HomeReport = {
  range: HomeRange; previousRange: HomeRange; minDate: string;
  metrics: HomeMetrics; previousMetrics: HomeMetrics; team: HomePerformance[];
  trends: Record<HomeTrendMetric, HomeTrendPoint[]>; bucketDays: number;
  stages: { stage: string; count: number }[];
  sales: HomeSalesReport;
};
export type HomeData = {
  name: string; workspaceName: string; isAdmin: boolean; asOf: string;
  periods: Record<HomePeriod, { metrics: HomeMetrics; team: HomePerformance[] }>;
  unavailable: string[];
  report: HomeReport;
  preferenceKey: string;
};

export function validHomeDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function resolveHomeRange(requested: Partial<HomeRange> | undefined, today: string): HomeRange {
  const { from, to } = requested ?? {};
  return validHomeDate(from) && validHomeDate(to) && from >= "1900-01-01" && from <= to && to <= today
    ? { from, to } : { from: today, to: today };
}

export function homePreviousRange(range: HomeRange): HomeRange {
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;
  return { from: shiftDay(range.from, -days), to: shiftDay(range.from, -1) };
}

// Won customers are a current pipeline snapshot: updated_at is not a win date.
// Orders belong to the current account owner; email credit belongs to the sender.
export function buildHomePeriod(input: HomeInputs, period: HomePeriod | HomeRange, now: Date, includeTeam: boolean) {
  const today = analyticsDay(now), month = today.slice(0, 7);
  const inPeriod = (value: string) => {
    const day = analyticsDay(value);
    return Boolean(day && day <= today && (typeof period === "object" ? day >= period.from && day <= period.to : period === "all" || (period === "today" ? day === today : day.startsWith(month))));
  };
  const companyMap = new Map(input.companies.map(row => [row.id, row]));
  const emails = input.emails.filter(row => inPeriod(row.sentAt));
  const orders = input.orders.filter(row => companyMap.has(row.companyId) && !["draft", "cancelled"].includes(row.status) && inPeriod(row.date));
  const totals = new Map<string, number>();
  for (const row of orders) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.totalMinor);
  const metrics: HomeMetrics = {
    newCompanies: input.companies.filter(row => inPeriod(row.createdAt)).length,
    emailsSent: emails.length, orders: orders.length,
    wonCustomers: input.companies.filter(row => row.stage === "won").length,
    openOpportunities: input.companies.filter(row => !["won", "lost"].includes(row.stage)).length,
    orderValues: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => ({ currency, minor })),
  };
  const team: HomePerformance[] = includeTeam ? input.members.map(member => {
    const owned = input.companies.filter(row => row.ownerId === member.id);
    const memberOrders = orders.filter(row => companyMap.get(row.companyId)?.ownerId === member.id);
    const sales = new Map<string, number>();
    for (const row of memberOrders) sales.set(row.currency, (sales.get(row.currency) ?? 0) + row.totalMinor);
    return { ...member, customers: owned.length, wonCustomers: owned.filter(row => row.stage === "won").length,
      newCustomers: owned.filter(row => inPeriod(row.createdAt)).length,
      emailsSent: emails.filter(row => row.ownerId === member.id).length,
      orders: memberOrders.length,
      orderValues: [...sales].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => ({ currency, minor })) };
  }).sort((a, b) => b.orders - a.orders || b.wonCustomers - a.wonCustomers || b.emailsSent - a.emailsSent || a.name.localeCompare(b.name)) : [];
  return { metrics, team };
}

export function buildHomeReport(input: HomeInputs, requested: Partial<HomeRange> | undefined, now: Date, includeTeam: boolean): HomeReport {
  const today = analyticsDay(now), range = resolveHomeRange(requested, today), previousRange = homePreviousRange(range);
  const dates = [...input.companies.map(row => analyticsDay(row.createdAt)), ...input.emails.map(row => analyticsDay(row.sentAt)), ...input.orders.map(row => analyticsDay(row.date))].filter(day => day >= "1900-01-01" && day <= today).sort();
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;
  const bucketDays = Math.max(1, Math.ceil(days / 60));
  const companyIds = new Set(input.companies.map(row => row.id));
  const activity: Record<HomeTrendMetric, string[]> = {
    newCompanies: input.companies.map(row => row.createdAt), emailsSent: input.emails.map(row => row.sentAt),
    orders: input.orders.filter(row => companyIds.has(row.companyId) && !["draft", "cancelled"].includes(row.status)).map(row => row.date),
  };
  const trends = {} as HomeReport["trends"];
  const hourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" });
  for (const metric of ["newCompanies", "emailsSent", "orders"] as const) {
    const hourly = days === 1 && metric !== "orders";
    const points: HomeTrendPoint[] = Array.from({ length: hourly ? 24 : Math.ceil(days / bucketDays) }, (_, index) => ({
      date: hourly ? `${range.from}T${String(index).padStart(2, "0")}:00:00+08:00` : shiftDay(range.from, index * bucketDays),
      previousDate: hourly ? `${previousRange.from}T${String(index).padStart(2, "0")}:00:00+08:00` : shiftDay(previousRange.from, index * bucketDays), current: 0, previous: 0,
    }));
    for (const value of activity[metric]) {
      const day = analyticsDay(value);
      const field = day >= range.from && day <= range.to ? "current" : day >= previousRange.from && day <= previousRange.to ? "previous" : null;
      if (!field) continue;
      const start = field === "current" ? range.from : previousRange.from;
      const index = hourly ? Number(hourFormatter.format(new Date(value)))
        : Math.floor(Math.round((Date.parse(day) - Date.parse(start)) / 86400000) / bucketDays);
      if (points[index]) points[index][field]++;
    }
    trends[metric] = points;
  }
  const stages = ["new", "contacted", "replied", "interested", "big_order", "won", "lost"].map(stage => ({ stage, count: input.companies.filter(row => row.stage === stage).length }));
  return { range, previousRange, minDate: dates[0] ?? today, ...buildHomePeriod(input, range, now, includeTeam),
    previousMetrics: buildHomePeriod(input, previousRange, now, false).metrics, trends, bucketDays, stages,
    sales: buildHomeSales(input, range, previousRange, trends.orders, bucketDays) };
}
