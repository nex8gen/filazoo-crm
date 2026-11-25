import { AnalyticsTrendPlot } from "@/components/ui/analytics-chart-card";
import { prepareTrend } from "@/components/analytics-chart";
import type { AnalyticsSeriesMetric, AnalyticsSeriesPoint } from "@/lib/analytics-dashboard";

type SparklineProps = {
  data: AnalyticsSeriesPoint[];
  previousData: AnalyticsSeriesPoint[];
  metric: AnalyticsSeriesMetric;
  label: string;
  locale: string;
  formatValue: (value: number) => string;
};

export function AnalyticsSparkline({ data, previousData, metric, label, locale, formatValue }: SparklineProps) {
  const { series, rangeLabel } = prepareTrend(data, previousData, metric, locale);
  if (!data.length) return null;

  const period = (points: AnalyticsSeriesPoint[]) =>
    rangeLabel({ from: points[0].date, to: points[points.length - 1].endDate });

  return <AnalyticsTrendPlot
    size="sparkline"
    label={label}
    data={series}
    currentLabel={period(data)}
    previousLabel={previousData.length ? period(previousData) : undefined}
    formatValue={formatValue}
  />;
}
