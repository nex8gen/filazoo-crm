"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChartNoAxesCombined, Download, Mail, Plus, RefreshCw, Search, TriangleAlert, Users, Workflow } from "lucide-react";
import { PageActions } from "@/components/page-header";
import { FlowViewToggle } from "@/components/flow-view-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { emptyFlowAnalyticsCounts, flowAnalyticsCsv, flowAnalyticsRanges, type FlowAnalyticsPoint, type FlowAnalyticsReport, type FlowAnalyticsRow } from "@/lib/flow-analytics";
import { useLanguage } from "@/components/language-provider";

const selectClass = "h-9 max-w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const colors = ["#059669", "#2563eb", "#8b5cf6", "#d97706", "#db2777"];
const metrics = { sent: "Emails sent", failed: "Failed runs", skipped: "Skipped emails" } as const;
type Metric = keyof typeof metrics;

export function FlowAnalytics({ report, canEdit, initialQuery = "", initialStatus = "all" }: { report: FlowAnalyticsReport; canEdit: boolean; initialQuery?: string; initialStatus?: string }) {
  const router = useRouter();
  const { language } = useLanguage();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);
  const [flowId, setFlowId] = useState("all");
  const [metric, setMetric] = useState<Metric>("sent");
  const [page, setPage] = useState(1);
  const [pending, startTransition] = useTransition();
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);
  const date = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }), [language]);
  const rows = useMemo(() => report.rows.filter(row => (flowId === "all" || row.id === flowId) && (status === "all" || row.status === status) && row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name)), [report.rows, query, status, flowId, metric]);
  const totals = rows.reduce((sum, row) => { for (const key of Object.keys(sum) as Array<keyof typeof sum>) sum[key] += row[key]; return sum; }, emptyFlowAnalyticsCounts());
  const pageCount = Math.max(1, Math.ceil(rows.length / 25)), currentPage = Math.min(page, pageCount);
  const visible = rows.slice((currentPage - 1) * 25, currentPage * 25);

  function exportCsv() {
    const url = URL.createObjectURL(new Blob(["\uFEFF", flowAnalyticsCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `workflow-analytics-${report.range}-${report.asOf.slice(0, 10)}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="scroll-surface h-full min-h-0 overflow-y-auto bg-muted/20" aria-busy={pending}>
    <PageActions><FlowViewToggle active="analytics" />{canEdit ? <Link href="/workflow?create=1" className={buttonVariants()}><Plus aria-hidden />Create workflow</Link> : null}</PageActions>
    <div className="space-y-5 px-5 pb-6 pt-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto"><h2 className="text-base font-medium">Workflow analytics</h2><p className="mt-1 text-xs text-muted-foreground">Email activity and run outcomes across all workflows.</p></div>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw aria-hidden className={pending ? "animate-spin" : ""} />Refresh</Button>
        <Button variant="outline" size="sm" disabled={!rows.length || pending} onClick={exportCsv}><Download aria-hidden />Export CSV</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-48 flex-1 gap-1.5 text-xs text-muted-foreground">Search workflows<div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 size-4" /><Input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search workflows" className="h-9 pl-9" /></div></label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">Date range<select value={report.range} disabled={pending} className={selectClass} onChange={event => { const params = new URLSearchParams({ range: event.target.value }); if (query) params.set("q", query); if (status !== "all") params.set("status", status); setPage(1); startTransition(() => router.push(`/workflow/analytics?${params}`)); }}>{Object.entries(flowAnalyticsRanges).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid max-w-full gap-1.5 text-xs text-muted-foreground">Workflow<select value={flowId} onChange={event => { setFlowId(event.target.value); setPage(1); }} className={`${selectClass} sm:max-w-64`}><option value="all">All workflows</option>{report.rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">Status<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className={selectClass}><option value="all">All statuses</option><option value="live">Live</option><option value="paused">Paused</option><option value="draft">Draft</option></select></label>
        {query || status !== "all" || flowId !== "all" ? <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setStatus("all"); setFlowId("all"); setPage(1); }}>Clear filters</Button> : null}
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[{ label: "Emails sent", value: totals.sent, detail: "Accepted by the sending server", icon: Mail }, { label: "Recipients emailed", value: totals.recipients, detail: "Unique addresses within each workflow", icon: Users }, { label: "Failed runs", value: totals.failed, detail: `${number.format(totals.errors)} error events in this period`, icon: TriangleAlert }, { label: "Active runs now", value: totals.active, detail: `${number.format(totals.blocked)} blocked · ${number.format(totals.retrying)} retrying`, icon: Workflow }].map(({ label, value, detail, icon: Icon }) => <div key={label} className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{label}</span><Icon aria-hidden className="size-4" /></div><p className="mt-2 text-2xl font-semibold tabular-nums">{number.format(value)}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>)}
      </div>
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-medium">Workflow performance over time</h3><p className="mt-1 text-xs text-muted-foreground">Top five workflows by {metrics[metric].toLowerCase()} · {report.bucket === "month" ? "Monthly" : "Daily"} totals · UTC</p></div><label><span className="sr-only">Chart metric</span><select className={selectClass} value={metric} onChange={event => { setMetric(event.target.value as Metric); setPage(1); }}>{Object.entries(metrics).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <PerformanceChart rows={rows} series={report.series} metric={metric} language={language} />
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Performance by workflow</h3><span className="text-xs text-muted-foreground">{number.format(rows.length)} workflows</span></div>
        <div className="crm-table-frame rounded-xl border bg-card">
          <Table className="min-w-[1450px]"><caption className="sr-only">Workflow email activity, run outcomes, and current active runs</caption><TableHeader><TableRow><TableHead className="min-w-64">Workflow</TableHead><TableHead>Status</TableHead>{["Emails sent", "Recipients", "Skipped", "Failed runs", "Completed", "Active now", "Blocked now", "Open events", "Click events", "Error events"].map(label => <TableHead key={label} className="whitespace-nowrap text-right">{label}</TableHead>)}<TableHead className="min-w-48">Last activity (UTC)</TableHead></TableRow></TableHeader><TableBody>
            {visible.map(row => <TableRow key={row.id}><TableCell><Link href={`/workflow?flow=${encodeURIComponent(row.id)}`} className="font-medium hover:text-primary hover:underline">{row.name}</Link>{row.latestIssue ? <details className="mt-1 max-w-80 text-xs text-amber-700 dark:text-amber-400"><summary className="cursor-pointer">Latest issue in period</summary><p className="mt-1 whitespace-normal break-words leading-5">{row.latestIssue}</p></details> : null}<p className="mt-1 text-xs text-muted-foreground">{number.format(row.started)} started · {number.format(row.cancelled)} stopped · {number.format(row.dryRun)} dry runs · {number.format(row.retrying)} retrying now</p></TableCell><TableCell><Badge variant={row.status === "live" ? "live" : "secondary"} className="capitalize">{row.status}</Badge></TableCell>{[row.sent, row.recipients, row.skipped, row.failed, row.completed, row.active, row.blocked, row.opens, row.clicks, row.errors].map((value, index) => <TableCell key={index} className={`text-right tabular-nums ${value && (index === 3 || index === 6 || index === 9) ? "text-amber-700 dark:text-amber-400" : ""}`}>{number.format(value)}</TableCell>)}<TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.lastActivity ? date.format(new Date(row.lastActivity)) : "—"}</TableCell></TableRow>)}
            {!visible.length ? <TableRow><TableCell colSpan={13} className="h-28 text-center text-sm text-muted-foreground">{report.rows.length ? "No workflows match these filters." : "No workflows yet. Create a workflow to start tracking activity."}</TableCell></TableRow> : null}
          </TableBody></Table>
        </div>
        <TablePagination className="mt-4" page={currentPage} pageCount={pageCount} start={visible.length ? (currentPage - 1) * 25 + 1 : 0} end={Math.min(currentPage * 25, rows.length)} total={rows.length} itemLabel="workflows" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
      </div>
      <details className="rounded-xl border bg-card text-xs"><summary className="cursor-pointer px-4 py-3 font-medium">About these metrics</summary><div className="space-y-2 border-t p-4 leading-5 text-muted-foreground"><p>Emails sent counts recorded email sends accepted by the sending server. Inbox delivery and bounce confirmation are not available. Completed runs can finish without sending any email; dry runs and skipped emails are counted separately.</p><p>Recipients are unique recorded email addresses within each workflow; the same person can appear in more than one workflow. Open and click events include repeat activity and can include automated scanners.</p><p>Email activity uses event dates in UTC. Run outcomes use the current run status and completion date, or the start date for older records without a completion date. Active, blocked, and retrying runs show their current state across all dates. Error events may include issues that were later resolved.</p><p>Updated {date.format(new Date(report.asOf))} UTC · {report.from ? `Period starts ${date.format(new Date(report.from))} UTC` : "All recorded history"}</p></div></details>
    </div>
  </section>;
}

function PerformanceChart({ rows, series, metric, language }: { rows: FlowAnalyticsRow[]; series: Record<string, FlowAnalyticsPoint[]>; metric: Metric; language: string }) {
  const top = rows.filter(row => row[metric] > 0).slice(0, 5);
  if (!top.length) return <div className="grid min-h-64 place-content-center gap-2 text-center"><ChartNoAxesCombined aria-hidden className="mx-auto mb-2 size-7 text-muted-foreground" /><p className="text-sm font-medium">No activity in this period</p><p className="text-xs text-muted-foreground">Try another date range or workflow filter.</p></div>;
  const values = top.map(row => series[row.id] || []);
  const max = Math.max(1, ...values.flatMap(points => points.map(point => point[metric])));
  const count = values[0].length;
  const x = (index: number) => 50 + (count > 1 ? index / (count - 1) * 920 : 460);
  const y = (value: number) => 220 - value / max * 190;
  const formatter = new Intl.DateTimeFormat(language, { month: "short", day: "numeric", timeZone: "UTC" });
  const indices = [...new Set([0, Math.floor((count - 1) / 3), Math.floor((count - 1) * 2 / 3), count - 1])];
  return <>
    <svg role="img" aria-label={`${metrics[metric]} over time for the top ${top.length} workflows`} viewBox="0 0 1000 260" className="h-auto min-h-48 w-full overflow-visible">
      <title>{metrics[metric]} over time</title>
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1="50" x2="970" y1={y(max * fraction)} y2={y(max * fraction)} stroke="currentColor" className="text-border" strokeDasharray="4 4" /><text x="40" y={y(max * fraction) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{Number((max * fraction).toFixed(1))}</text></g>)}
      {indices.map(index => <text key={index} x={x(index)} y="249" textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">{formatter.format(new Date(`${values[0][index].date}T00:00:00Z`))}</text>)}
      {values.map((points, flowIndex) => <g key={top[flowIndex].id}><polyline fill="none" stroke={colors[flowIndex]} strokeWidth="2.5" strokeLinejoin="round" points={points.map((point, index) => `${x(index)},${y(point[metric])}`).join(" ")} />{points.filter(point => point[metric] > 0).map(point => <circle key={point.date} cx={x(points.indexOf(point))} cy={y(point[metric])} r="3.5" fill={colors[flowIndex]}><title>{top[flowIndex].name}: {point[metric]} {metrics[metric].toLowerCase()} · {point.date}</title></circle>)}</g>)}
    </svg>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">{top.map((row, index) => <Link key={row.id} href={`/workflow?flow=${encodeURIComponent(row.id)}`} className="flex max-w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors[index] }} /><span className="max-w-72 truncate">{row.name}</span></Link>)}</div>
  </>;
}
