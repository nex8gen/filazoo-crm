"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Check, Pencil, RefreshCw } from "lucide-react";
import { analyticsChange, analyticsDay } from "@/lib/analytics-dashboard";
import type { HomeData, HomeRange } from "@/lib/home";
import { homeMetricIds, homeMetricValue, replaceHomeMetric, type HomeMetricId } from "@/lib/home-metrics";
import { useHomeMetrics } from "@/components/use-home-metrics";
import { HomeDateRange, homeRangeLabel } from "@/components/home-date-range";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

const HomeMetricChart = dynamic(() => import("@/components/home-metric-chart").then(module => module.HomeMetricChart), { loading: () => <div role="status" className="h-60 animate-pulse rounded-lg bg-muted/30">Loading chart…</div> });
const definitions: Record<HomeMetricId, { label: string; title: string; description: string; sources: string[] }> = {
  newCompanies: { label: "Leads", title: "Leads over time", description: "New customer accounts added in the selected period.", sources: ["Customers"] },
  orders: { label: "Orders", title: "Orders over time", description: "Confirmed orders, excluding drafts and cancellations.", sources: ["Customers", "Orders"] },
  sales: { label: "Sales", title: "Sales over time", description: "Total value of confirmed orders", sources: ["Customers", "Orders"] },
  averageOrderValue: { label: "Average order value", title: "Average order value over time", description: "Confirmed sales divided by confirmed orders", sources: ["Customers", "Orders"] },
  conversionRate: { label: "Conversion rate", title: "Lead-to-order conversion", description: "Share of new leads with a confirmed order in the same period.", sources: ["Customers", "Orders"] },
  emailsSent: { label: "Emails sent", title: "Emails sent over time", description: "Successfully sent CRM emails.", sources: ["Sent emails"] },
  wonCustomers: { label: "Customers won", title: "Current customer pipeline", description: "Current stages across all time; historical win dates are unavailable.", sources: ["Customers"] },
};
const stageLabels: Record<string, string> = { new: "New", contacted: "Contacted", replied: "Replied", interested: "Interested", big_order: "Big order", won: "Won", lost: "Lost" };

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return <svg aria-hidden="true" viewBox="0 0 38 16" className="h-4 w-9"><polyline points={values.map((value, index) => `${values.length === 1 ? 19 : index / (values.length - 1) * 36 + 1},${14 - value / max * 12}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function Change({ current, previous }: { current: number | null; previous: number | null }) {
  const change = current === null || previous === null ? null : analyticsChange(current, previous);
  if (change === null) return <span className="text-xs text-muted-foreground" title="No prior activity">—</span>;
  return <span className={`text-xs font-medium tabular-nums ${change > 0 ? "text-primary" : change < 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{change > 0 ? "+" : ""}{Number(change.toFixed(1))}%</span>;
}

export function HomeOverview({ data, refreshing, onRangeChange, onRefresh }: { data: HomeData; refreshing: boolean; onRangeChange: (range: HomeRange) => void; onRefresh: () => void }) {
  const [opened, setOpened] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const preferences = useHomeMetrics(data.preferenceKey);
  const { report } = data;
  const currency = preferences.currency && report.sales.currencies.includes(preferences.currency) ? preferences.currency : report.sales.defaultCurrency;
  const today = analyticsDay(data.asOf);
  const currentLabel = homeRangeLabel(report.range, today), previousLabel = homeRangeLabel(report.previousRange, today);
  const changeMetric = (index: number, next: HomeMetricId) => {
    preferences.save({ metrics: replaceHomeMetric(preferences.metrics, index, next), currency });
    setEditing(null);
  };

  return <section className="home-overview" aria-label="Sales at a glance" aria-busy={refreshing}>
    <div className="home-overview-date"><HomeDateRange range={report.range} minDate={report.minDate} asOf={data.asOf} disabled={refreshing} onChange={onRangeChange} /><span aria-hidden="true" className="text-muted-foreground">·</span><span className="text-[13px] text-muted-foreground">{data.isAdmin ? "All activity" : "Your activity"}</span></div>
    <div className="home-overview-metrics">{preferences.metrics.map((id, index) => {
      const metric = definitions[id], snapshot = id === "wonCustomers";
      const ready = metric.sources.every(source => !data.unavailable.includes(source));
      const { current, previous, points } = homeMetricValue(report, id, currency);
      const monetary = id === "sales" || id === "averageOrderValue";
      const format = (value: number | null) => value === null ? "—" : monetary ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100) : id === "conversionRate" ? `${Number(value.toFixed(1))}%` : value.toLocaleString();
      return <Popover key={index} open={opened === index} onOpenChange={open => { setOpened(current => open ? index : current === index ? null : current); if (!open) setEditing(current => current === index ? null : current); }}>
        <PopoverTrigger openOnHover delay={180} closeDelay={200} className="home-overview-metric" data-muted={opened !== null && opened !== index ? "true" : undefined} aria-label={`${metric.label}: ${ready ? format(current) : "unavailable"}. Open detailed analysis.`}>
          <span className="home-overview-label">{metric.label}</span>
          <span className="home-overview-value"><strong>{ready ? format(current) : "—"}</strong>{ready && !snapshot && points ? <span className="inline-flex items-center gap-1.5 text-primary"><Sparkline values={points.filter(point => point.current !== null && (!point.date.includes("T") || Date.parse(point.date) <= Date.parse(data.asOf))).map(point => point.current!)} /><Change current={current} previous={previous} /></span> : <span className="text-xs font-normal text-muted-foreground">{snapshot ? "Current" : "—"}</span>}</span>
        </PopoverTrigger>
        <PopoverContent align="center" side="bottom" sideOffset={12} className="home-metric-popup !w-[min(600px,calc(100vw-2rem))] !gap-0 !rounded-xl !p-5">
          <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><strong className="text-3xl font-semibold tracking-tight tabular-nums">{ready ? format(current) : "—"}</strong>{ready && !snapshot ? <Change current={current} previous={previous} /> : null}</div><PopoverTitle className="mt-2 text-sm">{metric.title}</PopoverTitle><PopoverDescription className="mt-1 text-xs leading-5">{metric.description}{monetary ? ` · ${currency}` : ""}</PopoverDescription></div>
            <button type="button" onClick={() => setEditing(current => current === index ? null : index)} aria-label={editing === index ? "Done editing metric" : `Edit ${metric.label} metric`} aria-expanded={editing === index} className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">{editing === index ? <Check className="size-4" /> : <Pencil className="size-4" />}</button>
          </div>
          {editing === index ? <div className="mt-5 border-t pt-4"><p className="mb-3 text-xs font-medium">Choose a metric</p><div role="group" aria-label="Available metrics" className="grid grid-cols-2 gap-2">{homeMetricIds.map(option => <button key={option} type="button" aria-pressed={id === option} onClick={() => changeMetric(index, option)} className={`flex min-h-9 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs ${id === option ? "border-primary/30 bg-brand-soft text-primary" : "border-border hover:bg-muted"}`}>{definitions[option].label}{id === option ? <Check className="size-3.5 shrink-0" /> : null}</button>)}</div>{monetary ? <label className="mt-4 flex items-center justify-between gap-3 text-xs">Currency<select aria-label="Sales currency" value={currency} onChange={event => preferences.save({ metrics: preferences.metrics, currency: event.target.value })} className="rounded-md border bg-background px-3 py-2">{report.sales.currencies.map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}</div>
            : !ready ? <p role="status" className="py-10 text-center text-sm text-muted-foreground">This report is unavailable. Refresh to retry.</p>
            : snapshot ? <div className="mt-5 space-y-3">{report.stages.map(row => <div key={row.stage} className="grid grid-cols-[80px_1fr_35px] items-center gap-3 text-xs"><span className="text-muted-foreground">{stageLabels[row.stage]}</span><span className="h-2 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${row.stage === "won" ? "bg-primary" : "bg-[#8ecbe6]"}`} style={{ width: `${row.count / Math.max(1, ...report.stages.map(stage => stage.count)) * 100}%` }} /></span><span className="text-right font-medium tabular-nums">{row.count.toLocaleString()}</span></div>)}</div>
            : points ? <div className="mt-4"><HomeMetricChart key={`${id}:${currency}:${report.range.from}:${report.range.to}`} points={points} currentLabel={currentLabel} previousLabel={previousLabel} asOf={data.asOf} format={monetary ? "money" : id === "conversionRate" ? "percent" : "count"} currency={currency} /></div> : null}
        </PopoverContent>
      </Popover>;
    })}</div>
    <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh Home data" className="home-overview-refresh"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} /></button>
  </section>;
}
