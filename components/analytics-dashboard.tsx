"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Eye, LayoutGrid, X } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { AnalyticsFilters, type AnalyticsFiltersValue } from "@/components/analytics-filters";
import { dashboardLayout, type AnalyticsChannel, type AnalyticsDashboardData, type DashboardWidgetId } from "@/lib/analytics-dashboard";
import { Button } from "@/components/ui/button";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

type PeriodValue = { currentPeriod: number; previousPeriod: number };
type Range = { from: Date; to: Date };
const channelLabels: Record<AnalyticsChannel, string> = { meta: "Meta", store: "Direct / Shopify", partner: "Partner / referral" };
const channelColors: Record<AnalyticsChannel, string> = { meta: "#3b82f6", store: "#10b981", partner: "#f59e0b" };
const stageLabels: Record<string, string> = { new: "Profile created", contacted: "Catalog sent", replied: "Customer replied", interested: "Qualified interest", big_order: "Quote / bulk order", won: "Order confirmed", lost: "Closed / not proceeding" };
const stageRanks: Record<string, number> = { new: 0, contacted: 1, replied: 2, interested: 3, big_order: 4, won: 5, lost: -1 };

function atDay(value: string | Date) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function addDays(value: Date, amount: number) { const date = new Date(value); date.setDate(date.getDate() + amount); return date; }
function dateKey(value: string | Date) { const date = atDay(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function inRange(value: string, range: Range) { const date = atDay(value).getTime(); return date >= atDay(range.from).getTime() && date <= atDay(range.to).getTime(); }
function daysIn(range: Range) { return Math.round((atDay(range.to).getTime() - atDay(range.from).getTime()) / 86_400_000) + 1; }
function datesIn(range: Range) { return Array.from({ length: daysIn(range) }, (_, index) => addDays(range.from, index)); }
function comparisonRange(range: Range, mode: AnalyticsFiltersValue["comparison"]): Range {
  if (mode === "previous_year") { const from = new Date(range.from); const to = new Date(range.to); from.setFullYear(from.getFullYear() - 1); to.setFullYear(to.getFullYear() - 1); return { from, to }; }
  const to = addDays(range.from, -1); return { from: addDays(to, -(daysIn(range) - 1)), to };
}
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const compact = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const money = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
const delta = (current: number, previous: number) => previous === 0 ? (current === 0 ? 0 : 100) : ((current - previous) / Math.abs(previous)) * 100;

function Trend({ current, previous }: { current: number; previous: number }) {
  const change = delta(current, previous);
  const positive = change >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}><Icon className="size-3.5" />{Math.abs(change).toFixed(1)}%</span>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-44 place-items-center rounded-lg border border-dashed bg-muted/20 px-6 text-center text-sm text-muted-foreground">{children}</div>;
}

function LineChart({ current, previous, labels, previousLabels, metricLabel, showComparison, valueFormatter = compact, axisFormatter = compact }: { current: number[]; previous: number[]; labels: string[]; previousLabels: string[]; metricLabel: string; showComparison: boolean; valueFormatter?: (value: number) => string; axisFormatter?: (value: number) => string }) {
  const currentTotal = sum(current); const previousTotal = sum(previous);
  const chartData = current.map((value, index) => ({ date: labels[index], previousDate: previousLabels[index], current: value, previous: previous[index] ?? 0 }));
  const chartConfig = { current: { label: "Current period", color: "#0ea5e9" }, previous: { label: "Comparison period", color: "#bae6fd" } } satisfies ChartConfig;
  return <div><div className="mb-3 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2"><p className="text-2xl font-semibold tracking-tight">{valueFormatter(currentTotal)}</p>{showComparison ? <Trend current={currentTotal} previous={previousTotal} /> : null}</div><p className="mt-1 text-xs text-muted-foreground">{showComparison ? `Compared with ${valueFormatter(previousTotal)} in the comparison period` : "Comparison is turned off"}</p></div></div>{chartData.length ? <ChartContainer config={chartConfig} className="h-[320px] w-full aspect-auto"><AreaChart accessibilityLayer data={chartData} margin={{ top: 12, right: 10, left: 4, bottom: 4 }}><defs><linearGradient id={`fill-${metricLabel.replaceAll(" ", "-")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-current)" stopOpacity={0.2} /><stop offset="95%" stopColor="var(--color-current)" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={44} /><YAxis tickLine={false} axisLine={false} tickMargin={10} width={66} tickFormatter={axisFormatter} /><Tooltip cursor={{ stroke: "var(--border)", strokeWidth: 1 }} formatter={(value, name, item) => [valueFormatter(Number(value)), name === "current" ? item.payload.date : item.payload.previousDate]} contentStyle={{ borderRadius: 8, borderColor: "var(--border)", background: "var(--popover)", color: "var(--popover-foreground)", fontSize: 13 }} />{showComparison ? <Area dataKey="previous" type="monotone" stroke="var(--color-previous)" strokeWidth={2} strokeDasharray="5 5" fill="transparent" dot={false} isAnimationActive={false} /> : null}<Area dataKey="current" type="monotone" stroke="var(--color-current)" strokeWidth={2.5} fill={`url(#fill-${metricLabel.replaceAll(" ", "-")})`} dot={false} isAnimationActive={false} /></AreaChart></ChartContainer> : <EmptyState>No CRM records in this period.</EmptyState>}</div>;
}

function Widget({ title, subtitle, children, className = "", onOptions }: { title: string; subtitle: string; children: React.ReactNode; className?: string; onOptions: () => void }) {
  return <section className={`min-w-0 rounded-xl border bg-card shadow-sm ${className}`}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><h2 className="font-medium">{title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p></div><Button variant="ghost" size="icon-sm" aria-label={`Options for ${title}`} onClick={onOptions}><LayoutGrid /></Button></header><div className="p-5">{children}</div></section>;
}

function OpportunityChannels({ counts }: { counts: Array<{ channel: AnalyticsChannel; count: number }> }) {
  const total = sum(counts.map((item) => item.count));
  if (!total) return <EmptyState>No attributed opportunities in this period.</EmptyState>;
  const gradient = counts.filter((item) => item.count > 0).map((item, index, visible) => { const start = (sum(visible.slice(0, index).map((entry) => entry.count)) / total) * 100; const end = start + (item.count / total) * 100; return `${channelColors[item.channel]} ${start}% ${end}%`; }).join(", ");
  return <div className="flex flex-col items-center gap-6 sm:flex-row xl:flex-col 2xl:flex-row"><div className="relative size-44 shrink-0 rounded-full" style={{ background: `conic-gradient(${gradient})` }}><div className="absolute inset-6 grid place-items-center rounded-full bg-card text-center"><div><p className="text-xl font-semibold">{total}</p><p className="text-xs text-muted-foreground">opportunities</p></div></div></div><div className="w-full space-y-3">{counts.map((item) => <div key={item.channel} className="flex items-center gap-2"><i className="size-2.5 rounded-full" style={{ background: channelColors[item.channel] }} /><span className="min-w-0 flex-1 truncate text-xs">{channelLabels[item.channel]}</span><span className="text-xs font-medium">{item.count}</span></div>)}</div></div>;
}

function ConversionFunnel({ current, previous }: { current: Array<{ label: string; count: number }>; previous: number[] }) {
  const base = current[0]?.count ?? 0;
  if (!base) return <EmptyState>No opportunities entered the CRM in this period.</EmptyState>;
  return <div className="space-y-4">{current.map((item, index) => { const width = Math.max(item.count ? 8 : 0, (item.count / base) * 100); return <div key={item.label}><div className="mb-1.5 flex items-end justify-between gap-3"><div><p className="text-xs font-medium">{item.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{index === 0 ? "100%" : `${((item.count / base) * 100).toFixed(1)}% of opportunities`}</p></div><div className="text-right"><p className="text-sm font-semibold">{item.count}</p><Trend current={item.count} previous={previous[index] ?? 0} /></div></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} /></div></div>; })}</div>;
}

function PipelineBreakdown({ rows, currency }: { rows: Array<{ stage: string; count: number; value: number }>; currency: string }) {
  if (!rows.some((row) => row.count)) return <EmptyState>No pipeline records in this period.</EmptyState>;
  return <div className="space-y-1">{rows.map((row) => <div key={row.stage} className="flex items-center justify-between border-b py-2.5 last:border-0"><span className="text-sm">{stageLabels[row.stage] ?? row.stage}<small className="ml-2 text-muted-foreground">{row.count}</small></span><span className="font-mono text-sm">{money(row.value, currency)}</span></div>)}</div>;
}

function TopProducts({ rows }: { rows: Array<{ sku: string; name: string; current: number; previous: number }> }) {
  if (!rows.length) return <EmptyState>No products were included in catalogs during this period.</EmptyState>;
  return <div className="crm-table-frame overflow-x-auto"><table className="crm-table w-full min-w-[520px]"><thead><tr><th>Product</th><th className="text-right">Catalogs</th><th className="text-right">Change</th></tr></thead><tbody>{rows.map((product, index) => <tr key={product.sku}><td><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-md bg-muted text-xs font-semibold">{index + 1}</span><div><p className="text-sm font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.sku}</p></div></div></td><td className="text-right text-sm">{product.current}</td><td className="text-right"><Trend current={product.current} previous={product.previous} /></td></tr>)}</tbody></table></div>;
}

function CustomizationPanel({ visibleWidgets, onToggle, onClose }: { visibleWidgets: DashboardWidgetId[]; onToggle: (id: DashboardWidgetId) => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-[80]"><button aria-label="Close customization panel" className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} /><aside className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l bg-background p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Customize dashboard</h2><p className="mt-1 text-sm text-muted-foreground">Choose which widgets appear in your overview.</p></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X /></Button></div><div className="mt-7 space-y-2">{dashboardLayout.chartWidgets.map((widget) => { const enabled = visibleWidgets.includes(widget.id); return <button key={widget.id} onClick={() => onToggle(widget.id)} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted"><span className={`grid size-5 place-items-center rounded border ${enabled ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{enabled && <Check className="size-3.5" />}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{widget.title}</span><span className="block text-xs text-muted-foreground">{widget.type.replaceAll("_", " ").toLowerCase()}</span></span><Eye className={`size-4 ${enabled ? "text-primary" : "text-muted-foreground"}`} /></button>; })}</div><div className="mt-8 flex justify-end"><Button onClick={onClose}>Done</Button></div></aside></div>;
}

export function AnalyticsDashboard({ data }: { data: AnalyticsDashboardData }) {
  const minDate = atDay(`${data.minDate}T00:00:00`); const maxDate = atDay(`${data.maxDate}T00:00:00`);
  const initialFrom = new Date(Math.max(minDate.getTime(), addDays(maxDate, -29).getTime()));
  const [filters, setFilters] = useState<AnalyticsFiltersValue>({ range: { from: initialFrom, to: maxDate }, channels: ["meta", "store", "partner"], currency: data.currencies[0] ?? "USD", comparison: "previous_period" });
  const [customizing, setCustomizing] = useState(false);
  const [visibleWidgets, setVisibleWidgets] = useState<DashboardWidgetId[]>(dashboardLayout.chartWidgets.map((widget) => widget.id));
  const computed = useMemo(() => {
    const previousRange = comparisonRange(filters.range, filters.comparison);
    const opportunityFilter = (range: Range) => data.opportunities.filter((item) => inRange(item.createdAt, range) && filters.channels.includes(item.channel) && item.currency === filters.currency);
    const leadFilter = (range: Range) => data.leads.filter((item) => inRange(item.createdAt, range) && filters.channels.includes(item.channel));
    const currentOpps = opportunityFilter(filters.range); const previousOpps = opportunityFilter(previousRange);
    const currentLeads = leadFilter(filters.range); const previousLeads = leadFilter(previousRange);
    const currentDates = datesIn(filters.range); const previousDates = datesIn(previousRange);
    const daily = (rows: typeof currentOpps, dates: Date[], field: "value" | "count") => dates.map((date) => { const matches = rows.filter((row) => dateKey(row.createdAt) === dateKey(date)); return field === "value" ? sum(matches.map((row) => row.estimatedValue)) : matches.length; });
    const dailyLeads = (rows: typeof currentLeads, dates: Date[]) => dates.map((date) => rows.filter((row) => dateKey(row.createdAt) === dateKey(date)).length);
    const labels = currentDates.map((date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    const previousLabels = previousDates.map((date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    const won = (rows: typeof currentOpps) => rows.filter((row) => row.stage === "won").length;
    const funnel = (rows: typeof currentOpps) => [
      { label: "Incoming opportunities", count: rows.length },
      { label: "Catalog sent", count: rows.filter((row) => stageRanks[row.stage] >= 1).length },
      { label: "Customer replied", count: rows.filter((row) => stageRanks[row.stage] >= 2).length },
      { label: "Qualified / quote", count: rows.filter((row) => stageRanks[row.stage] >= 3).length },
      { label: "Order confirmed", count: won(rows) },
    ];
    const catalogCounts = (range: Range) => { const counts = new Map<string, number>(); for (const catalog of data.catalogs.filter((item) => inRange(item.createdAt, range) && filters.channels.includes(item.channel) && item.currency === filters.currency)) for (const sku of new Set(catalog.productSkus)) counts.set(sku, (counts.get(sku) ?? 0) + 1); return counts; };
    const currentCatalogs = catalogCounts(filters.range); const previousCatalogs = catalogCounts(previousRange);
    const topProducts = [...currentCatalogs].map(([sku, current]) => ({ sku, name: data.products[sku] ?? sku, current, previous: previousCatalogs.get(sku) ?? 0 })).sort((a, b) => b.current - a.current || a.name.localeCompare(b.name)).slice(0, 10);
    return {
      currentOpps, previousOpps, labels, previousLabels,
      pipelineCurrent: daily(currentOpps, currentDates, "value"), pipelinePrevious: daily(previousOpps, previousDates, "value"),
      leadsCurrent: dailyLeads(currentLeads, currentDates), leadsPrevious: dailyLeads(previousLeads, previousDates),
      summary: {
        pipelineValue: { currentPeriod: sum(currentOpps.map((row) => row.estimatedValue)), previousPeriod: sum(previousOpps.map((row) => row.estimatedValue)) },
        conversionRate: { currentPeriod: currentOpps.length ? won(currentOpps) / currentOpps.length * 100 : 0, previousPeriod: previousOpps.length ? won(previousOpps) / previousOpps.length * 100 : 0 },
        dealsWon: { currentPeriod: won(currentOpps), previousPeriod: won(previousOpps) },
        opportunities: { currentPeriod: currentOpps.length, previousPeriod: previousOpps.length },
      } satisfies Record<string, PeriodValue>,
      channelCounts: (["meta", "store", "partner"] as const).filter((channel) => filters.channels.includes(channel)).map((channel) => ({ channel, count: currentOpps.filter((row) => row.channel === channel).length })),
      funnelCurrent: funnel(currentOpps), funnelPrevious: funnel(previousOpps).map((item) => item.count),
      breakdown: ["new", "contacted", "replied", "interested", "big_order", "won", "lost"].map((stage) => ({ stage, count: currentOpps.filter((row) => row.stage === stage).length, value: sum(currentOpps.filter((row) => row.stage === stage).map((row) => row.estimatedValue)) })),
      topProducts,
    };
  }, [data, filters]);

  const visible = (id: DashboardWidgetId) => visibleWidgets.includes(id);
  const toggleWidget = (id: DashboardWidgetId) => setVisibleWidgets((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const formatCard = (format: string, value: number) => format === "currency" ? money(value, filters.currency) : format === "percentage" ? `${value.toFixed(1)}%` : Math.round(value).toLocaleString();
  const channelDescription = filters.channels.length === 3 ? "All attributed channels" : filters.channels.map((item) => channelLabels[item]).join(", ");
  const dateLabel = `${filters.range.from.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${filters.range.to.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return <div className="mx-auto max-w-[1500px] space-y-6"><div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><LayoutGrid className="size-3.5" /><span>Analytics</span><span>/</span><span>Executive overview</span></div><h1 className="text-2xl font-semibold tracking-tight">CRM performance</h1><p className="mt-1 text-sm text-muted-foreground">Live opportunity, pipeline, and acquisition data from your CRM.</p></div><div className="xl:max-w-[850px]"><AnalyticsFilters value={filters} minDate={minDate} maxDate={maxDate} currencies={data.currencies} onChange={setFilters} onCustomize={() => setCustomizing(true)} /></div></div></div>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{dateLabel}</span><span>{filters.comparison === "none" ? "No comparison" : filters.comparison === "previous_year" ? "compared with the same period last year" : `compared with the preceding ${daysIn(filters.range)} days`}</span><span>{channelDescription}</span><span className="ml-auto flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-emerald-500" />Live CRM records</span></div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{dashboardLayout.summaryCards.map((card) => { const values = computed.summary[card.metricKey]; return <article key={card.id} className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-start justify-between"><p className="text-xs font-medium text-muted-foreground">{card.title}</p>{filters.comparison !== "none" ? <Trend current={values.currentPeriod} previous={values.previousPeriod} /> : null}</div><p className="mt-3 text-2xl font-semibold tracking-tight">{formatCard(card.format, values.currentPeriod)}</p><p className="mt-1 text-xs text-muted-foreground">{filters.comparison !== "none" ? `from ${formatCard(card.format, values.previousPeriod)}` : "Current selection"}</p></article>; })}</section>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">{visible("pipeline-over-time") && <Widget onOptions={() => setCustomizing(true)} title="Pipeline value over time" subtitle="Estimated opportunity value by date added" className="xl:col-span-12"><LineChart current={computed.pipelineCurrent} previous={computed.pipelinePrevious} labels={computed.labels} previousLabels={computed.previousLabels} metricLabel="Pipeline value" showComparison={filters.comparison !== "none"} valueFormatter={(value) => money(value, filters.currency)} axisFormatter={(value) => money(value, filters.currency)} /></Widget>}{visible("opportunity-channels") && <Widget onOptions={() => setCustomizing(true)} title="Opportunity channels" subtitle="Companies added by source" className="xl:col-span-4"><OpportunityChannels counts={computed.channelCounts} /></Widget>}{visible("lead-attribution") && <Widget onOptions={() => setCustomizing(true)} title="Lead attribution" subtitle={`${channelDescription}, current vs comparison period`} className="xl:col-span-8"><LineChart current={computed.leadsCurrent} previous={computed.leadsPrevious} labels={computed.labels} previousLabels={computed.previousLabels} metricLabel="Captured leads" showComparison={filters.comparison !== "none"} valueFormatter={(value) => `${Math.round(value)} leads`} /></Widget>}{visible("conversion-funnel") && <Widget onOptions={() => setCustomizing(true)} title="Conversion funnel" subtitle="CRM stage progression for opportunities added in this period" className="xl:col-span-4"><ConversionFunnel current={computed.funnelCurrent} previous={computed.funnelPrevious} /></Widget>}{visible("pipeline-breakdown") && <Widget onOptions={() => setCustomizing(true)} title="Pipeline breakdown" subtitle={`Estimated value and deal count in ${filters.currency}`} className="xl:col-span-5"><PipelineBreakdown rows={computed.breakdown} currency={filters.currency} /></Widget>}{visible("top-products") && <Widget onOptions={() => setCustomizing(true)} title="Top catalog products" subtitle="Ranked by inclusion in generated catalogs" className="xl:col-span-7"><TopProducts rows={computed.topProducts} /></Widget>}</div>
    {customizing && <CustomizationPanel visibleWidgets={visibleWidgets} onToggle={toggleWidget} onClose={() => setCustomizing(false)} />}</div>;
}
