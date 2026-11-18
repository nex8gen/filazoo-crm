"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChartNoAxesCombined } from "lucide-react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { flowChartMetrics, prepareFlowAnalyticsChart, type FlowChartMetric } from "@/lib/flow-analytics-chart";
import type { FlowAnalyticsPoint, FlowAnalyticsRow } from "@/lib/flow-analytics";

const colors = ["var(--chart-1)", "var(--primary)", "#8b5cf6", "#d97706", "#db2777"];

export function FlowAnalyticsChart({ rows, series, metric, language, monthly = false }: {
  rows: FlowAnalyticsRow[];
  series: Record<string, FlowAnalyticsPoint[]>;
  metric: FlowChartMetric;
  language: string;
  monthly?: boolean;
}) {
  const { workflows, data } = useMemo(() => prepareFlowAnalyticsChart(rows, series, metric), [rows, series, metric]);
  const number = new Intl.NumberFormat(language);
  const date = new Intl.DateTimeFormat(language, { month: "short", ...(monthly ? { year: "2-digit" as const } : { day: "numeric" as const }), timeZone: "UTC" });
  const fullDate = new Intl.DateTimeFormat(language, { month: "short", ...(monthly ? {} : { day: "numeric" as const }), year: "numeric", timeZone: "UTC" });
  const formatDate = (value: string, full = false) => (full ? fullDate : date).format(new Date(`${value}T00:00:00Z`));
  const config: ChartConfig = Object.fromEntries(workflows.map((row, index) => [row.key, { label: row.name, color: colors[index] }]));

  if (!workflows.length || !data.length) return <div role="status" className="grid h-[280px] place-content-center gap-2 text-center"><ChartNoAxesCombined aria-hidden className="mx-auto mb-1 size-6 text-muted-foreground" /><p className="text-sm font-medium">No activity in this period</p><p className="text-xs text-muted-foreground">Try a different date range.</p></div>;

  return <>
    <ChartContainer config={config} className="h-[260px] min-w-0 w-full aspect-auto sm:h-[280px]" aria-label={`${flowChartMetrics[metric]} over time`}>
      <LineChart accessibilityLayer data={data} margin={{ left: 0, right: 12, top: 12, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={40} tickMargin={10} tickFormatter={value => formatDate(String(value))} />
        <YAxis axisLine={false} tickLine={false} width={40} allowDecimals={false} tickFormatter={value => new Intl.NumberFormat(language, { notation: "compact" }).format(Number(value))} />
        <Tooltip labelFormatter={label => formatDate(String(label), true)} formatter={(value, name) => [number.format(Number(value)), config[String(name)]?.label ?? String(name)]}
          contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, maxWidth: 300 }}
          labelStyle={{ marginBottom: 6, fontWeight: 500 }} itemStyle={{ whiteSpace: "normal", overflowWrap: "anywhere" }} />
        {workflows.map(row => <Line key={row.id} type="linear" dataKey={row.key} stroke={`var(--color-${row.key})`} strokeWidth={2} dot={data.length === 1 ? { r: 3 } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} isAnimationActive={false} />)}
      </LineChart>
    </ChartContainer>
    <div className="mt-4 grid gap-x-6 gap-y-2 border-t pt-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Chart workflows">
      {workflows.map((row, index) => <Link key={row.id} href={`/workflow?flow=${encodeURIComponent(row.id)}`} title={row.name} className="flex min-w-0 items-center gap-2 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors[index] }} /><span className="min-w-0 flex-1 truncate">{row.name}</span><span className="shrink-0 tabular-nums text-foreground">{number.format(row[metric])}</span></Link>)}
    </div>
  </>;
}
