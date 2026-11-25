"use client";

import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { AnalyticsChartCard, type AnalyticsChartCardProps, type TrendPoint } from "@/components/ui/analytics-chart-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { analyticsChange, previousRange, type AnalyticsFiltersValue, type AnalyticsSeriesMetric, type AnalyticsSeriesPoint } from "@/lib/analytics-dashboard";

const chartLabels = {
  orderValue: { title: "Sales", description: "Total value of confirmed orders", empty: "No orders in this period." },
  companies: { title: "Leads", description: "New customer accounts added in the selected period.", empty: "No new companies in this period." },
  averageOrderValue: { title: "Average order value over time", description: "Average value per confirmed order in the selected period.", empty: "No orders in this period." },
};

type ChartMetric = keyof typeof chartLabels;

export function prepareTrend(data: AnalyticsSeriesPoint[], previousData: AnalyticsSeriesPoint[], metric: AnalyticsSeriesMetric, locale: string) {
  const shortDate = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const fullDate = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const date = (day: string) => new Date(`${day}T00:00:00Z`);
  const rangeLabel = (range: { from: string; to: string }) =>
    fullDate.formatRange(date(range.from), date(range.to)).replace(/\s+/gu, " ");
  const bucketLabel = (point?: AnalyticsSeriesPoint) => point ? rangeLabel({ from: point.date, to: point.endDate }) : "—";
  const series: TrendPoint[] = Array.from({ length: Math.max(data.length, previousData.length) }, (_, index) => {
    const now = data[index], then = previousData[index];
    return {
      tick: shortDate.format(date((now ?? then).date)),
      period: bucketLabel(now), value: now?.[metric] ?? null,
      previousPeriod: bucketLabel(then), previous: then?.[metric] ?? null,
    };
  });
  return { series, rangeLabel };
}

function periodValue(series: AnalyticsSeriesPoint[], metric: ChartMetric) {
  if (metric === "companies") return series.reduce((sum, point) => sum + point.companies, 0);
  const total = series.reduce((sum, point) => sum + point.orderValue, 0);
  if (metric === "orderValue") return total;
  const orders = series.reduce((sum, point) => sum + point.orders, 0);
  return orders ? total / orders : null;
}

type AnalyticsChartProps = {
  data: AnalyticsSeriesPoint[];
  previousData: AnalyticsSeriesPoint[];
  filters: AnalyticsFiltersValue;
  locale: string;
  available?: boolean;
};

export function SalesAndLeadsChart({ companiesAvailable, ...props }: AnalyticsChartProps & { companiesAvailable: boolean }) {
  const { t } = useLanguage();
  const [metric, setMetric] = useState<"orderValue" | "companies">("orderValue");
  const list = <TabsList aria-label={t("Chart metric")} activateOnFocus className="group-data-horizontal/tabs:h-8">
    <TabsTrigger value="orderValue">{t(chartLabels.orderValue.title)}</TabsTrigger>
    <TabsTrigger value="companies">{t(chartLabels.companies.title)}</TabsTrigger>
  </TabsList>;

  return <Tabs value={metric} onValueChange={value => {
    if (value === "orderValue" || value === "companies") setMetric(value);
  }} className="min-w-0 [&>section]:flex-1">
    <AnalyticsChart {...props} metric={metric} available={metric === "companies" ? companiesAvailable : props.available}
      tabs={{ list, value: metric }} />
  </Tabs>;
}

export function AnalyticsChart({ data, previousData, metric, filters, locale, available = true, compact = false, tabs }: AnalyticsChartProps & {
  metric: ChartMetric;
  compact?: boolean;
  tabs?: AnalyticsChartCardProps["tabs"];
}) {
  const { t } = useLanguage();
  const formatter = metric === "companies" ? new Intl.NumberFormat(locale)
    : new Intl.NumberFormat(locale, { style: "currency", currency: filters.currency, maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const showComparison = filters.comparison !== "none";
  const { series, rangeLabel } = prepareTrend(data, showComparison ? previousData : [], metric, locale);
  const total = periodValue(data, metric), previous = periodValue(previousData, metric);
  const change = showComparison && total !== null && previous !== null ? analyticsChange(total, previous) : null;
  const labels = chartLabels[metric];

  return <AnalyticsChartCard
    tabs={tabs}
    title={t(labels.title)}
    description={t(labels.description)}
    value={total === null ? "—" : formatter.format(total)}
    change={change}
    data={series}
    currentLabel={rangeLabel(filters)}
    previousLabel={showComparison ? rangeLabel(previousRange(filters)) : undefined}
    formatValue={formatter.format}
    formatChange={value => percent.format(value / 100)}
    available={available}
    compact={compact}
    showDots={metric === "averageOrderValue"}
    unavailableText={t("This report is unavailable. Refresh to retry.")}
    emptyText={t(labels.empty)}
  />;
}
