import { z } from "zod";
import { emptyFlowAnalyticsCounts, type FlowAnalyticsReport } from "../flow-analytics.ts";

export const flowAnalyticsContextSchema = z.object({
  range: z.enum(["7", "30", "90", "all"]),
  query: z.string().trim().max(100).default(""),
  status: z.enum(["all", "live", "paused", "draft"]).default("all"),
  flowId: z.uuid().optional(),
  metric: z.enum(["sent", "failed", "skipped"]).default("sent"),
}).strict();
export type FlowAnalyticsContext = z.infer<typeof flowAnalyticsContextSchema>;

/** Inputs select filters only. Metric facts always come from a fresh authorized report. */
export function agentFlowAnalyticsReport(report: FlowAnalyticsReport, scope: FlowAnalyticsContext) {
  const rows = report.rows.filter(row => (!scope.flowId || row.id === scope.flowId)
    && (scope.status === "all" || row.status === scope.status)
    && row.name.toLocaleLowerCase().includes(scope.query.toLocaleLowerCase()))
    .sort((a, b) => b.blocked - a.blocked || b.failed - a.failed || b[scope.metric] - a[scope.metric] || a.name.localeCompare(b.name));
  const included = rows.slice(0, 50);
  const totals = rows.reduce((sum, row) => {
    for (const key of Object.keys(sum) as Array<keyof typeof sum>) sum[key] += row[key];
    return sum;
  }, emptyFlowAnalyticsCounts());
  return { scope, asOf: report.asOf, from: report.from, timezone: "UTC", bucket: report.bucket, totals,
    workflows: included.map(row => ({ ...row, latestIssue: row.latestIssue?.slice(0, 1000) ?? null, url: `/workflow?flow=${encodeURIComponent(row.id)}` })),
    series: Object.fromEntries(included.slice(0, 5).map(row => [row.id, report.series[row.id] ?? []])),
    coverage: { matching: rows.length, included: included.length, omitted: rows.length - included.length, totalsCoverAllMatches: true },
  };
}
