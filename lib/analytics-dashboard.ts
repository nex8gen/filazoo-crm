export type PeriodValue = {
  currentPeriod: number;
  previousPeriod: number;
};

export type DashboardWidgetId =
  | "sales-over-time"
  | "lead-attribution"
  | "sales-channels"
  | "conversion-funnel"
  | "sales-breakdown"
  | "top-products";

export const dashboardLayout = {
  globalFilters: {
    currentPeriod: { startDate: "2026-09-16", endDate: "2026-10-16", label: "Sep 16 – Oct 16, 2026" },
    previousPeriod: { startDate: "2026-08-16", endDate: "2026-09-15", label: "Aug 16 – Sep 15, 2026" },
    currency: "USD",
  },
  summaryCards: [
    { id: "gross-sales", title: "Gross sales", metricKey: "grossSales", format: "currency" },
    { id: "lead-conversion", title: "Lead conversion rate", metricKey: "conversionRate", format: "percentage" },
    { id: "deals-fulfilled", title: "Deals fulfilled", metricKey: "dealsFulfilled", format: "integer" },
    { id: "incoming-opportunities", title: "Incoming opportunities", metricKey: "opportunities", format: "integer" },
  ],
  chartWidgets: [
    { id: "sales-over-time", title: "Sales over time", type: "LINE_CHART", size: "wide" },
    { id: "lead-attribution", title: "Lead attribution", type: "LINE_CHART", size: "wide" },
    { id: "sales-channels", title: "Sales channels", type: "DONUT_CHART", size: "compact" },
    { id: "conversion-funnel", title: "Conversion funnel", type: "FUNNEL_BAR_CHART", size: "compact" },
    { id: "sales-breakdown", title: "Sales breakdown", type: "FINANCIAL_SUMMARY", size: "compact" },
    { id: "top-products", title: "Top products", type: "RANKED_TABLE", size: "wide" },
  ] as const,
};

const currentSales = [52.82, 62.84, 49.18, 59.16, 68.86, 64.5, 74.86, 80.67, 61.45, 71.21, 77.65, 89.05, 83.29, 95.34, 90.82, 107.41, 101.18, 115.46, 108.98, 122.9, 113.07, 133.6, 126.36, 142.95, 129.04, 149.15, 136.9, 156.25, 145.82, 164.07, 159.35];
const previousSales = [48.25, 55.7, 51.15, 54.8, 61.35, 59.2, 66.4, 71.65, 58.3, 65.75, 69.9, 78.45, 76.8, 84.2, 81.75, 91.4, 88.65, 99.3, 96.25, 105.6, 101.35, 114.2, 110.75, 124.3, 116.45, 131.8, 122.65, 139.4, 129.75, 145.6, 140.21];
const metaLeads = [7, 8, 6, 7, 9, 10, 13, 16, 11, 9, 10, 12, 14, 18, 20, 17, 15, 13, 14, 19, 22, 25, 21, 18, 16, 17, 23, 27, 24, 20, 18];
const previousMetaLeads = [6, 7, 7, 6, 8, 8, 9, 11, 9, 8, 9, 10, 11, 13, 14, 13, 12, 11, 12, 14, 16, 18, 16, 15, 14, 14, 17, 19, 18, 16, 15];
const storeLeads = [4, 5, 4, 5, 5, 6, 6, 7, 5, 6, 6, 7, 7, 8, 8, 9, 8, 9, 9, 10, 9, 11, 10, 12, 11, 12, 11, 13, 12, 14, 13];
const previousStoreLeads = [4, 4, 5, 4, 5, 5, 5, 6, 5, 5, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 10, 9, 10, 10, 11, 10, 11, 11];

export const timeSeriesPayload = {
  dailyTimeline: currentSales.map((grossSalesCurrent, index) => {
    const date = new Date(Date.UTC(2026, 8, 16 + index));
    return {
      date: date.toISOString().slice(0, 10), grossSalesCurrent,
      grossSalesPrevious: previousSales[index], metaLeadsCount: metaLeads[index],
      metaLeadsCountPrevious: previousMetaLeads[index], storeLeadsCount: storeLeads[index],
      storeLeadsCountPrevious: previousStoreLeads[index],
    };
  }),
  salesBreakdown: {
    grossSales: { currentPeriod: 3194.19, previousPeriod: 2850.21 },
    discounts: { currentPeriod: -626.49, previousPeriod: -501.25 },
    reversals: { currentPeriod: -54.7, previousPeriod: -40.96 },
    netSales: { currentPeriod: 2513, previousPeriod: 2308 },
    shipping: { currentPeriod: 31.98, previousPeriod: 28 },
    tax: { currentPeriod: 0, previousPeriod: 0 },
    totalSales: { currentPeriod: 2544.98, previousPeriod: 2336 },
  },
  salesChannels: [
    { channel: "Meta ads", color: "#3ecf8e", revenue: { currentPeriod: 1512.73, previousPeriod: 1284.8 }, orders: { currentPeriod: 41, previousPeriod: 34 } },
    { channel: "Direct / store", color: "#6366f1", revenue: { currentPeriod: 786.25, previousPeriod: 794.24 }, orders: { currentPeriod: 28, previousPeriod: 27 } },
    { channel: "Partner / referral", color: "#f59e0b", revenue: { currentPeriod: 246, previousPeriod: 256.96 }, orders: { currentPeriod: 15, previousPeriod: 11 } },
  ],
  topProducts: [
    { name: "Professional Commerce Plan", sku: "B2B-SUB-PRO", revenue: { currentPeriod: 1128, previousPeriod: 940 }, volume: { currentPeriod: 24, previousPeriod: 20 } },
    { name: "Operations Automation Bundle", sku: "B2B-OPS-BUNDLE", revenue: { currentPeriod: 819, previousPeriod: 693 }, volume: { currentPeriod: 13, previousPeriod: 11 } },
    { name: "Advanced Analytics Add-on", sku: "B2B-ANALYTICS", revenue: { currentPeriod: 462, previousPeriod: 399 }, volume: { currentPeriod: 22, previousPeriod: 19 } },
  ],
  conversionFunnel: [
    { step: "Total traffic / sessions", count: { currentPeriod: 3492, previousPeriod: 3210 } },
    { step: "Added to cart / initialized trial", count: { currentPeriod: 412, previousPeriod: 365 } },
    { step: "Reached checkout", count: { currentPeriod: 176, previousPeriod: 151 } },
    { step: "Completed purchase / contract signed", count: { currentPeriod: 84, previousPeriod: 72 } },
  ],
};

export const analyticsDashboard = { dashboardLayout, timeSeriesPayload };
