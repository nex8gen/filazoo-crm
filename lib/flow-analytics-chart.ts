import type { FlowAnalyticsPoint, FlowAnalyticsRow } from "./flow-analytics.ts";

export const flowChartMetrics = { sent: "Emails sent", failed: "Failed runs", skipped: "Skipped emails" } as const;
export type FlowChartMetric = keyof typeof flowChartMetrics;

/** Align by date rather than array position, including sparse historical series. */
export function prepareFlowAnalyticsChart(rows: FlowAnalyticsRow[], series: Record<string, FlowAnalyticsPoint[]>, metric: FlowChartMetric) {
  const workflows = rows.filter(row => row[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name)).slice(0, 5)
    .map((row, index) => ({ ...row, key: `flow_${index}` }));
  const dates = new Set<string>();
  const values = workflows.map(row => new Map((series[row.id] ?? []).map(point => {
    dates.add(point.date);
    return [point.date, point[metric]];
  })));
  const data = [...dates].sort().map(date => ({ date, ...Object.fromEntries(workflows.map((row, index) => [row.key, values[index].get(date) ?? 0])) }));
  return { workflows, data };
}
