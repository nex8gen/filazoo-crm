export type DashboardWidgetId =
  | "pipeline-over-time"
  | "lead-attribution"
  | "opportunity-channels"
  | "conversion-funnel"
  | "pipeline-breakdown"
  | "top-products";

export type AnalyticsChannel = "meta" | "store" | "partner";

export type AnalyticsOpportunity = {
  id: string;
  createdAt: string;
  channel: AnalyticsChannel;
  stage: "new" | "contacted" | "replied" | "interested" | "big_order" | "won" | "lost";
  estimatedValue: number;
  estimatedOrderQuantity: number;
  currency: string;
};

export type AnalyticsLead = {
  id: string;
  createdAt: string;
  channel: AnalyticsChannel;
};

export type AnalyticsCatalog = {
  id: string;
  createdAt: string;
  productSkus: string[];
  channel: AnalyticsChannel;
  currency: string;
};

export type AnalyticsDashboardData = {
  opportunities: AnalyticsOpportunity[];
  leads: AnalyticsLead[];
  catalogs: AnalyticsCatalog[];
  products: Record<string, string>;
  currencies: string[];
  minDate: string;
  maxDate: string;
};

export const dashboardLayout = {
  summaryCards: [
    { id: "pipeline-value", title: "Pipeline value", metricKey: "pipelineValue", format: "currency" },
    { id: "lead-conversion", title: "Win conversion rate", metricKey: "conversionRate", format: "percentage" },
    { id: "deals-won", title: "Deals won", metricKey: "dealsWon", format: "integer" },
    { id: "incoming-opportunities", title: "Incoming opportunities", metricKey: "opportunities", format: "integer" },
  ] as const,
  chartWidgets: [
    { id: "pipeline-over-time", title: "Pipeline value over time", type: "LINE_CHART" },
    { id: "lead-attribution", title: "Lead attribution", type: "LINE_CHART" },
    { id: "opportunity-channels", title: "Opportunity channels", type: "DONUT_CHART" },
    { id: "conversion-funnel", title: "Conversion funnel", type: "FUNNEL_BAR_CHART" },
    { id: "pipeline-breakdown", title: "Pipeline breakdown", type: "FINANCIAL_SUMMARY" },
    { id: "top-products", title: "Top catalog products", type: "RANKED_TABLE" },
  ] as const,
};

export function analyticsChannelForSource(source: string | null | undefined): AnalyticsChannel {
  const normalized = source?.toLowerCase() ?? "";
  if (["meta", "facebook", "instagram", "messenger"].some((value) => normalized.includes(value))) return "meta";
  if (["partner", "referral", "reseller", "wholesale"].some((value) => normalized.includes(value))) return "partner";
  return "store";
}
