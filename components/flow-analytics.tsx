"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Info, MoreHorizontal, Plus, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { PageActions } from "@/components/page-header";
import { FlowViewToggle } from "@/components/flow-view-toggle";
import { FlowAnalyticsChart } from "@/components/flow-analytics-chart";
import { WorkflowAnalyticsIdeas } from "@/components/workflow-analytics-ideas";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { flowAnalyticsCsv, flowAnalyticsRanges, type FlowAnalyticsReport, type FlowAnalyticsRow } from "@/lib/flow-analytics";
import { flowChartMetrics, type FlowChartMetric } from "@/lib/flow-analytics-chart";
import { useLanguage } from "@/components/language-provider";

function AnalyticsSelect({ label, value, options, onChange, disabled, className = "" }: {
  label: string; value: string; options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void; disabled?: boolean; className?: string;
}) {
  return <Select value={value} onValueChange={value => { if (value !== null) onChange(value); }} disabled={disabled}>
    <SelectTrigger size="sm" aria-label={label} className={`h-9 min-w-0 text-xs shadow-none ${className}`}><SelectValue className="truncate" /></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}

function MetricDefinitions() {
  return <Popover><PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Metric definitions" className="text-muted-foreground" />}><Info className="size-3.5" /></PopoverTrigger>
    <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-3 p-4 text-xs leading-5">
      <PopoverTitle>Metric definitions</PopoverTitle>
      <p><strong className="font-medium">Sent</strong> counts emails accepted by the sending server, without confirming inbox delivery.</p>
      <p><strong className="font-medium">Recipients</strong> are unique within each workflow. The same person can count in multiple workflows.</p>
      <p><strong className="font-medium">Completed</strong> counts finished runs, including runs without an email. Failed runs and error events are counted separately.</p>
      <p>Dates use UTC. Active, blocked and retrying runs show their current state, independent of the date range.</p>
    </PopoverContent>
  </Popover>;
}

function WorkflowDetails({ row, number, date }: { row: FlowAnalyticsRow; number: Intl.NumberFormat; date: Intl.DateTimeFormat }) {
  const counts = [["Started", row.started], ["Stopped", row.cancelled], ["Skipped emails", row.skipped], ["Dry runs", row.dryRun], ["Blocked now", row.blocked], ["Retrying now", row.retrying], ["Open events", row.opens], ["Click events", row.clicks], ["Error events", row.errors]] as const;
  const needsAttention = row.blocked > 0 || row.retrying > 0 || row.failed > 0;
  return <Popover><PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Details for ${row.name}`} title={needsAttention ? "Needs attention" : "View details"} className={needsAttention ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"} />}>{needsAttention ? <TriangleAlert /> : <MoreHorizontal />}</PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] gap-4 p-4">
      <PopoverTitle className="break-words text-sm">{row.name}</PopoverTitle>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">{counts.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{number.format(value)}</dd></div>)}</dl>
      {row.latestIssue ? <div className="border-t pt-3 text-xs"><p className="mb-1 font-medium">Latest issue</p><p className="break-words leading-5 text-muted-foreground">{row.latestIssue}</p></div> : null}
      <p className="text-xs text-muted-foreground">Last activity: {row.lastActivity ? `${date.format(new Date(row.lastActivity))} UTC` : "No activity"}</p>
      <p className="text-[11px] leading-4 text-muted-foreground">Open and click events can include repeat activity and automated scanners.</p>
    </PopoverContent>
  </Popover>;
}

export function FlowAnalytics({ report, canEdit, initialQuery = "", initialStatus = "all" }: { report: FlowAnalyticsReport; canEdit: boolean; initialQuery?: string; initialStatus?: string }) {
  const router = useRouter();
  const { language } = useLanguage();
  const [query, setQuery] = useState(initialQuery.slice(0, 100));
  const [status, setStatus] = useState(initialStatus);
  const [flowId, setFlowId] = useState("all");
  const [metric, setMetric] = useState<FlowChartMetric>("sent");
  const [page, setPage] = useState(1);
  const [pending, startTransition] = useTransition();
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);
  const date = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }), [language]);
  const rows = useMemo(() => report.rows.filter(row => (flowId === "all" || row.id === flowId) && (status === "all" || row.status === status) && row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name)), [report.rows, query, status, flowId, metric]);
  const pageCount = Math.max(1, Math.ceil(rows.length / 25)), currentPage = Math.min(page, pageCount);
  const visible = rows.slice((currentPage - 1) * 25, currentPage * 25);
  const filtered = Boolean(query || status !== "all" || flowId !== "all");

  function exportCsv() {
    const url = URL.createObjectURL(new Blob(["\uFEFF", flowAnalyticsCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `workflow-analytics-${report.range}-${report.asOf.slice(0, 10)}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="scroll-surface h-full min-h-0 overflow-y-auto bg-background" aria-busy={pending}
    data-ai-flow-analytics={JSON.stringify({ range: report.range, query: query.slice(0, 100), status, ...(flowId !== "all" ? { flowId } : {}), metric })}>
    <PageActions><FlowViewToggle active="analytics" />{canEdit ? <Link href="/workflow?create=1" className={buttonVariants()}><Plus aria-hidden />Create workflow</Link> : null}</PageActions>
    <WorkflowAnalyticsIdeas canEdit={canEdit} />
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5"><h2 className="text-base font-medium">Workflow analytics</h2><MetricDefinitions /></div>
        <div className="flex items-center gap-2"><Button variant="ghost" size="icon-sm" aria-label="Refresh analytics" title="Refresh analytics" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw aria-hidden className={pending ? "animate-spin" : ""} /></Button><Button variant="outline" size="sm" disabled={!rows.length || pending} onClick={exportCsv}><Download aria-hidden />Export CSV</Button></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 sm:mr-auto sm:w-72"><Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input type="search" aria-label="Search workflows" maxLength={100} value={query} onChange={event => { setQuery(event.target.value.slice(0, 100)); setPage(1); }} placeholder="Search workflows" className="h-9 pl-9 text-xs shadow-none" /></div>
        <AnalyticsSelect label="Date range" value={report.range} disabled={pending} options={Object.entries(flowAnalyticsRanges).map(([value, label]) => ({ value, label }))} onChange={value => { const params = new URLSearchParams({ range: value }); if (query) params.set("q", query); if (status !== "all") params.set("status", status); setPage(1); startTransition(() => router.push(`/workflow/analytics?${params}`)); }} />
        <AnalyticsSelect label="Workflow" value={flowId} options={[{ value: "all", label: "All workflows" }, ...report.rows.map(row => ({ value: row.id, label: row.name }))]} onChange={value => { setFlowId(value); setPage(1); }} className="max-w-52" />
        <AnalyticsSelect label="Status" value={status} options={[{ value: "all", label: "All statuses" }, { value: "live", label: "Live" }, { value: "paused", label: "Paused" }, { value: "draft", label: "Draft" }]} onChange={value => { setStatus(value); setPage(1); }} />
        {filtered ? <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setStatus("all"); setFlowId("all"); setPage(1); }}>Clear filters</Button> : null}
      </div>
      <Card className="min-w-0 gap-0 py-0 shadow-none">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5"><div><h3 className="text-sm font-medium">Activity over time</h3><p className="mt-1 text-xs text-muted-foreground">{report.bucket === "month" ? "Monthly" : "Daily"} · UTC{rows.filter(row => row[metric] > 0).length > 5 ? " · Top 5 workflows" : ""}</p></div><AnalyticsSelect label="Chart metric" value={metric} options={Object.entries(flowChartMetrics).map(([value, label]) => ({ value, label }))} onChange={value => { setMetric(value as FlowChartMetric); setPage(1); }} /></header>
        <div className="min-w-0 px-4 pb-4 sm:px-5 sm:pb-5"><FlowAnalyticsChart rows={rows} series={report.series} metric={metric} language={language} monthly={report.bucket === "month"} /></div>
      </Card>
      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Workflow performance</h3><span className="text-xs text-muted-foreground">{number.format(rows.length)} workflows</span></div>
        <div className="crm-table-frame rounded-xl border bg-card">
          <Table className="min-w-[860px]"><caption className="sr-only">Workflow performance for the selected period. Active runs show the current state.</caption><TableHeader><TableRow><TableHead className="w-[32%] min-w-52">Workflow</TableHead><TableHead>Status</TableHead>{["Sent", "Recipients", "Completed", "Failed", "Active now"].map(label => <TableHead key={label} className="whitespace-nowrap text-right">{label}</TableHead>)}<TableHead className="w-12"><span className="sr-only">Details</span></TableHead></TableRow></TableHeader><TableBody>
            {visible.map(row => <TableRow key={row.id}>
              <TableCell className="max-w-96"><Link href={`/workflow?flow=${encodeURIComponent(row.id)}`} className="block truncate text-sm text-[#1677ff] hover:underline dark:text-blue-400" title={row.name}>{row.name}</Link></TableCell>
              <TableCell><Badge variant={row.status === "live" ? "live" : row.status === "draft" ? "outline" : "secondary"} className="capitalize">{row.status}</Badge></TableCell>
              {[row.sent, row.recipients, row.completed, row.failed, row.active].map((value, index) => <TableCell key={index} className={`text-right tabular-nums ${value && index === 3 ? "text-amber-700 dark:text-amber-400" : ""}`}>{number.format(value)}</TableCell>)}
              <TableCell className="text-right"><WorkflowDetails row={row} number={number} date={date} /></TableCell>
            </TableRow>)}
            {!visible.length ? <TableRow><TableCell colSpan={8} className="h-28 text-center text-sm text-muted-foreground">{report.rows.length ? "No workflows match your filters." : "No workflows yet."}</TableCell></TableRow> : null}
          </TableBody></Table>
        </div>
        <TablePagination className="mt-2" page={currentPage} pageCount={pageCount} start={visible.length ? (currentPage - 1) * 25 + 1 : 0} end={Math.min(currentPage * 25, rows.length)} total={rows.length} itemLabel="workflows" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
      </div>
    </div>
  </section>;
}
