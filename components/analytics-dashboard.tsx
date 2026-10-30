"use client";
import { useWorkspaceState } from "@/components/workspace-memory";

import { useMemo, useTransition, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Building2, Check, CircleAlert, Download, Mail, MessageSquare, Package, RefreshCw, Sparkles, Workflow } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { AnalyticsFilters, initialAnalyticsFilters } from "@/components/analytics-filters";
import { analyticsChange, analyticsCsv, channelLabels, computeAnalytics, type AnalyticsDashboardData, type AnalyticsSource } from "@/lib/analytics-dashboard";
import { Button } from "@/components/ui/button";

const AnalyticsChart = dynamic(() => import("@/components/analytics-chart").then(module => module.AnalyticsChart), { loading: () => <div className="h-[250px] animate-pulse rounded-lg bg-muted/50" aria-label="Loading chart" /> });
const count = (value: number) => value.toLocaleString();
function ReportLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">{children}<ArrowRight className="size-3.5" /></Link>;
}
function Panel({ id, title, subtitle, link, children, available = true, className = "" }: { id?: string; title: string; subtitle: string; link?: { href: string; label: string }; children: ReactNode; available?: boolean; className?: string }) {
  return <section id={id} className={`min-w-0 scroll-mt-5 rounded-xl border bg-card ${className}`}>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4"><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p></div>{link ? <ReportLink href={link.href}>{link.label}</ReportLink> : null}</header>
    <div className="p-5">{available ? children : <Unavailable />}</div>
  </section>;
}
function Unavailable() { return <div role="status" className="flex min-h-24 items-center gap-2 rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground"><CircleAlert className="size-4 shrink-0" />This report is unavailable. Refresh to retry.</div>; }
function Empty({ children }: { children: ReactNode }) { return <p className="rounded-lg bg-muted/30 px-4 py-8 text-center text-xs text-muted-foreground">{children}</p>; }
function Change({ current, previous, enabled }: { current: number; previous: number; enabled: boolean }) {
  if (!enabled) return <span className="text-[11px] text-muted-foreground">Comparison off</span>;
  const change = analyticsChange(current, previous);
  if (change === null) return <span className="text-[11px] text-muted-foreground">No prior activity</span>;
  const Icon = change < 0 ? ArrowDownRight : ArrowUpRight;
  return <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Icon className="size-3.5" />{change > 0 ? "+" : ""}{change.toFixed(1)}% vs comparison</span>;
}
function Metric({ label, value, detail, children, available = true }: { label: string; value: string; detail: string; children?: ReactNode; available?: boolean }) {
  return <article className="min-w-0 rounded-xl border bg-card p-5"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-3 break-words text-2xl font-semibold tracking-tight tabular-nums 2xl:text-3xl">{available ? value : "Unavailable"}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p><div className="mt-4 border-t pt-3">{available ? children : <span className="text-[11px] text-muted-foreground">Refresh to retry</span>}</div></article>;
}
function SmallMetric({ label, value, warning = false }: { label: string; value: string | number; warning?: boolean }) {
  return <div className="min-w-0"><p className={`break-words text-xl font-semibold tabular-nums ${warning ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{label}</p></div>;
}
const channelColors = ["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-slate-500", "bg-amber-500", "bg-stone-400"];

export function AnalyticsDashboard({ data }: { data: AnalyticsDashboardData }) {
  const [filters, setFilters] = useWorkspaceState("analytics.filters", () => initialAnalyticsFilters(data));
  const [trend, setTrend] = useWorkspaceState<"companies" | "collected">("analytics.trend", "companies");
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();
  const { language } = useLanguage();
  const locale = language === "zh-CN" ? "zh-CN" : "en-US";
  const money = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency: filters.currency, maximumFractionDigits: 2 }).format(value);
  const report = useMemo(() => computeAnalytics(data, filters), [data, filters]);
  const ready = (...ids: AnalyticsSource["id"][]) => ids.every(id => data.sources.find(source => source.id === id)?.ok);
  const failures = data.sources.filter(source => !source.ok);
  const compare = filters.comparison !== "none";
  const companyReady = ready("companies"), billingReady = ready("companies", "invoices"), cashReady = ready("companies", "invoices", "payments");
  const emails = report.current.emails;
  const sent = emails.filter(row => row.direction === "sent" && row.status === "sent").length;
  const replies = emails.filter(row => row.direction === "received" && row.status === "received").length;
  const failedMail = emails.filter(row => row.status === "failed").length;
  const messages = report.current.messages;
  const flowFailed = report.current.runs.filter(row => row.status === "failed").length;
  const flowDone = report.current.runs.filter(row => row.status === "done").length;
  const overdueInvoices = [...report.overdueInvoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const refreshed = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }).format(new Date(data.asOf));

  function exportReport() {
    const value = (available: boolean, amount: string | number) => available ? amount : "Unavailable";
    const csv = analyticsCsv([
      ["Filazoo analytics", "Value"], ["From", filters.from], ["To", filters.to], ["Source", filters.channel], ["Owner", filters.owner], ["Currency (no FX conversion)", filters.currency], ["Snapshot at", data.asOf],
      ["Issued invoices (minor units)", value(billingReady, report.current.invoiced)], ["Cash collected (minor units)", value(cashReady, report.current.collected)],
      ["Outstanding (current, minor units)", value(billingReady, report.outstanding)], ["Overdue (current, minor units)", value(billingReady, report.overdue)],
      ["Confirmed order value (minor units)", value(ready("companies", "orders"), report.current.orderValue)], ["Your catalogs", value(ready("companies", "catalogs"), report.current.catalogs.length)],
      ["CRM emails sent", value(ready("companies", "emails"), sent)], ["CRM replies received", value(ready("companies", "emails"), replies)],
      ["Your open tasks (current)", value(ready("tasks"), report.openTasks.length)], ["Your overdue tasks (current)", value(ready("tasks"), report.overdueTasks.length)],
      ["Workspace runs started", value(ready("flows", "runs"), report.current.runs.length)], ["Workspace failed runs", value(ready("flows", "runs"), flowFailed)],
      ...report.channels.map(row => [`New companies: ${channelLabels[row.channel]}`, value(companyReady, row.count)]),
      ...report.topProducts.map(row => [`Catalog product: ${row.sku}`, value(ready("companies", "catalogs"), row.count)]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `filazoo-analytics-${filters.from}-${filters.to}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="mx-auto max-w-[1500px] space-y-5 pb-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace overview</p><h1 className="text-3xl font-semibold tracking-tight">Analytics</h1><p className="mt-2 text-sm text-muted-foreground">From first conversation to paid invoice.</p></div>
      <div className="flex flex-wrap items-center gap-2"><span className="mr-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={`size-1.5 rounded-full ${failures.length ? "bg-amber-500" : "bg-emerald-500"}`} />Updated {refreshed} CST</span><Button size="sm" variant="outline" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}><RefreshCw className={refreshing ? "animate-spin" : ""} />{refreshing ? "Refreshing…" : "Refresh"}</Button><Button size="sm" variant="outline" onClick={exportReport}><Download />Export CSV</Button></div>
    </header>
    <AnalyticsFilters value={filters} data={data} onChange={setFilters} />
    {failures.length ? <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs"><CircleAlert className="size-4 shrink-0 text-amber-600" /><div><p className="font-medium">Some reports could not be loaded</p><p className="mt-1 text-muted-foreground">{failures.map(source => source.label).join(", ")}. Affected metrics are marked unavailable.</p></div></div> : null}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="New companies" value={count(report.current.newCompanies)} detail="Created in the selected period · all currencies" available={companyReady}><Change current={report.current.newCompanies} previous={report.previous.newCompanies} enabled={compare} /></Metric>
      <Metric label="Confirmed orders" value={money(report.current.orderValue / 100)} detail="Order value in the selected period" available={companyReady && ready("orders")}><Change current={report.current.orderValue} previous={report.previous.orderValue} enabled={compare} /></Metric>
      <Metric label="Invoiced" value={money(report.current.invoiced / 100)} detail="Issued invoices by issue date · excludes drafts" available={billingReady}><Change current={report.current.invoiced} previous={report.previous.invoiced} enabled={compare} /></Metric>
      <Metric label="Cash collected" value={money(report.current.collected / 100)} detail="Recorded payments by payment date" available={cashReady}><Change current={report.current.collected} previous={report.previous.collected} enabled={compare} /></Metric>
    </div>
    <nav aria-label="Analytics sections" className="flex flex-wrap gap-x-5 gap-y-2 border-b pb-3 text-xs text-muted-foreground">{[{ id: "sales", label: "Sales & acquisition" }, { id: "billing", label: "Orders & receivables" }, { id: "engagement", label: "Engagement" }, { id: "operations", label: "Products & automation" }].map(item => <a key={item.id} href={`#${item.id}`} className="hover:text-foreground">{item.label}</a>)}</nav>
    <div id="sales" className="grid scroll-mt-5 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <Panel title="Activity over time" subtitle={`${filters.from} – ${filters.to} · daily or grouped into up to 90 intervals`} available={trend === "companies" ? companyReady : cashReady}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="text-2xl font-semibold tracking-tight">{trend === "companies" ? count(report.current.newCompanies) : money(report.current.collected / 100)}</p><p className="mt-1 text-xs text-muted-foreground">{trend === "companies" ? "New companies" : "Cash collected"}</p></div><div className="flex rounded-lg bg-muted/60 p-1">{[{ id: "companies", label: "Companies" }, { id: "collected", label: "Collections" }].map(item => <button type="button" aria-pressed={trend === item.id} key={item.id} onClick={() => setTrend(item.id as typeof trend)} className={`rounded-md px-3 py-1.5 text-xs ${trend === item.id ? "bg-background font-medium shadow-xs" : "text-muted-foreground"}`}>{item.label}</button>)}</div></div>
        <AnalyticsChart data={report.series} metric={trend} currency={filters.currency} locale={locale} />
      </Panel>
      <Panel title="Acquisition sources" subtitle="Unique new companies · multiple sources kept separate" link={{ href: "/companies", label: "Companies" }} available={companyReady}>
        <div className="space-y-5">{report.channels.map((row, index) => <div key={row.channel}><div className="mb-2 flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-2"><span className={`size-2 rounded-full ${channelColors[index]}`} />{channelLabels[row.channel]}</span><span className="tabular-nums">{row.count}<span className="ml-3 text-muted-foreground">{report.current.newCompanies ? Math.round(row.count / report.current.newCompanies * 100) : 0}%</span></span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${channelColors[index]}`} style={{ width: `${report.current.newCompanies ? row.count / report.current.newCompanies * 100 : 0}%` }} /></div></div>)}</div>
      </Panel>
    </div>
    <div className="grid gap-4">
      <Panel title="Needs attention" subtitle="Current overdue work · personal tasks and company follow-ups" link={{ href: "/tasks", label: "Your tasks" }} available={companyReady && ready("tasks")}>
        <div className="mb-5 grid grid-cols-3 gap-3"><SmallMetric label="Your overdue tasks" value={report.overdueTasks.length} warning={report.overdueTasks.length > 0} /><SmallMetric label="Overdue follow-ups" value={report.followups.length} warning={report.followups.length > 0} /><SmallMetric label="Your open tasks" value={report.openTasks.length} /></div>
        <div className="divide-y">{report.overdueTasks.slice(0, 3).map(task => <Link key={task.id} href={`/tasks?task=${task.id}`} className="flex items-center gap-3 py-3 text-xs hover:text-primary"><CircleAlert className="size-4 shrink-0 text-amber-600" /><span className="min-w-0 flex-1 truncate">{task.title}</span><ArrowRight className="size-3.5 shrink-0" /></Link>)}{report.followups.slice(0, 3).map(company => <Link key={company.id} href={`/companies/${company.id}`} className="flex items-center gap-3 py-3 text-xs hover:text-primary"><Building2 className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">Follow up with {company.name}</span><ArrowRight className="size-3.5 shrink-0" /></Link>)}</div>
        {!report.overdueTasks.length && !report.followups.length ? <Empty>No overdue tasks or company follow-ups.</Empty> : null}
        <p className="mt-4 text-[11px] text-muted-foreground">{report.completedTasks} of your tasks completed during the selected period. Company filters do not change personal tasks.</p>
      </Panel>
    </div>
    <div id="billing" className="grid scroll-mt-5 gap-4 xl:grid-cols-2">
      <Panel title="Orders & receivables" subtitle="Order activity for the period · balances as of now" link={{ href: "/invoices", label: "Invoices" }} available={billingReady && ready("orders")}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-7"><SmallMetric label="Confirmed order value" value={money(report.current.orderValue / 100)} /><SmallMetric label="Outstanding balance" value={money(report.outstanding / 100)} /><SmallMetric label="Orders in period" value={report.current.periodOrders.length} /><SmallMetric label="Overdue balance" value={money(report.overdue / 100)} warning={report.overdue > 0} /></div>
        <p className="mt-5 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">Orders use their order date and exclude drafts and cancellations. Receivables include all issued unpaid invoices in {filters.currency}, regardless of the date range.</p>
      </Panel>
      <Panel title="Overdue invoices" subtitle="Unpaid issued invoices past their due date · current" link={{ href: "/invoices?status=issued", label: "View issued" }} available={billingReady}>
        {overdueInvoices.length ? <div className="divide-y">{overdueInvoices.slice(0, 5).map(invoice => <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:text-primary"><div className="min-w-0"><p className="truncate text-xs font-medium">Invoice #{invoice.number}{invoice.companyId ? ` · ${report.companyMap.get(invoice.companyId)?.name ?? "Company"}` : ""}</p><p className="mt-1 text-[11px] text-muted-foreground">Due {invoice.dueDate}</p></div><span className="shrink-0 text-xs font-medium tabular-nums">{money((invoice.totalMinor - invoice.paidMinor) / 100)}</span></Link>)}</div> : <Empty>No overdue invoices in this currency and company scope.</Empty>}
      </Panel>
    </div>
    <div id="engagement" className="grid scroll-mt-5 gap-4 lg:grid-cols-3">
      <Panel title="CRM outreach" subtitle="Company-linked email activity · selected period" link={{ href: "/emails", label: "Email" }} available={companyReady && ready("emails")}><Mail className="mb-5 size-5 text-muted-foreground" /><div className="grid grid-cols-3 gap-2"><SmallMetric label="Sent" value={sent} /><SmallMetric label="Replies" value={replies} /><SmallMetric label="Failed" value={failedMail} warning={failedMail > 0} /></div><p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">CRM outreach records only. Personal inbox mail, provider delivery and email opens are not counted.</p></Panel>
      <Panel title="Messenger" subtitle="Workspace messages · selected period · all sources" link={{ href: "/messenger", label: "Messenger" }} available={ready("messages")}><MessageSquare className="mb-5 size-5 text-muted-foreground" /><div className="grid grid-cols-3 gap-2"><SmallMetric label="Received" value={messages.filter(row => row.direction === "inbound").length} /><SmallMetric label="Sent" value={messages.filter(row => row.direction === "outbound" && row.status === "sent").length} /><SmallMetric label="Failed" value={messages.filter(row => row.status === "failed").length} /></div><p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">Facebook and Instagram messages. Company source, account owner and currency filters do not apply.</p></Panel>
      <Panel title="Your AI usage" subtitle="Your assistant calls · selected period" available={ready("ai")}><Sparkles className="mb-5 size-5 text-muted-foreground" /><div className="grid grid-cols-3 gap-2"><SmallMetric label="Calls" value={report.current.ai.length} /><SmallMetric label="Tokens" value={count(report.current.ai.reduce((total, row) => total + row.tokens, 0))} /><SmallMetric label="Failed calls" value={report.current.ai.filter(row => !row.success).length} /></div><p className="mt-5 text-[11px] text-muted-foreground">Estimated usage cost: {new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 4 }).format(report.current.ai.reduce((total, row) => total + row.cost, 0))} USD</p></Panel>
    </div>
    <div id="operations" className="grid scroll-mt-5 gap-4 xl:grid-cols-2">
      <Panel title="Your catalog activity" subtitle="Product selections in your catalogs · selected period" link={{ href: "/catalogs/companies", label: "Your catalogs" }} available={companyReady && ready("catalogs", "products")}>
        <div className="mb-5 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-muted/60"><Package className="size-5 text-muted-foreground" /></span><div><p className="text-xl font-semibold">{report.current.catalogs.length}</p><p className="text-[11px] text-muted-foreground">Catalogs created in {filters.currency}</p></div></div>
        {report.topProducts.length ? <div className="divide-y">{report.topProducts.map((product, index) => <Link key={product.sku} href={`/catalogs/products/${encodeURIComponent(product.sku)}`} className="flex items-center gap-3 py-3 text-xs hover:text-primary"><span className="w-4 text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{product.name}</span><span className="mt-1 block text-[11px] text-muted-foreground">{product.sku}</span></span><span className="shrink-0 text-muted-foreground">{product.count} catalogs</span></Link>)}</div> : <Empty>No catalog product selections in this period.</Empty>}
        <p className="mt-4 text-[11px] text-muted-foreground">Each SKU counts once per catalog. Catalog selections do not measure purchases.</p>
      </Panel>
      <Panel title="Automation performance" subtitle="Workspace flows · runs started in the selected period" link={{ href: "/lead-channel/ai-agent", label: "Automation" }} available={ready("flows", "runs")}>
        <div className="mb-5 grid grid-cols-3 gap-3"><SmallMetric label="Live flows now" value={data.flows.filter(flow => flow.status === "live").length} /><SmallMetric label="Completed runs" value={flowDone} /><SmallMetric label="Failed runs" value={flowFailed} warning={flowFailed > 0} /></div>
        {report.flowRows.length ? <div className="divide-y">{[...report.flowRows].sort((a, b) => b.failed - a.failed || b.active - a.active).slice(0, 5).map(flow => <div key={flow.id} className="flex items-center gap-3 py-3 text-xs"><Workflow className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{flow.name}</span><span className={flow.failed ? "shrink-0 text-amber-600 dark:text-amber-400" : "shrink-0 text-muted-foreground"}>{flow.failed ? `${flow.failed} failed` : `${flow.active} active now`}</span></div>)}</div> : <Empty>No workspace flows configured.</Empty>}
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">Company and email-scoped flows are managed inside their own workspaces. Company filters do not apply here.</p>
      </Panel>
    </div>
    <Panel title="Product & inventory status" subtitle="Current active catalog and configured ERP stock snapshot" link={{ href: "/catalogs", label: "Products" }} available={ready("products", "inventory")}>
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4"><SmallMetric label="Active products" value={data.products.length} /><SmallMetric label="ERP stock records" value={data.inventory.configured ? data.inventory.tracked : "Not connected"} /><SmallMetric label="Unavailable stock records" value={data.inventory.configured ? data.inventory.unavailable : "—"} /><SmallMetric label="Inventory sync" value={data.inventory.error ? "Needs attention" : !data.inventory.configured ? "Not configured" : !data.inventory.lastSyncedAt ? "Awaiting sync" : data.inventory.stale ? "Stale" : "Up to date"} warning={data.inventory.error || data.inventory.stale} /></div>
      {data.inventory.lastSyncedAt ? <p className="mt-5 text-[11px] text-muted-foreground">Last stock sync: {new Intl.DateTimeFormat(locale, { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(data.inventory.lastSyncedAt))} CST</p> : null}
    </Panel>
    <details className="rounded-xl border bg-card text-xs"><summary className="cursor-pointer px-5 py-4 font-medium">Report definitions & data availability <span className="ml-2 font-normal text-muted-foreground">{data.sources.filter(source => source.ok).length}/{data.sources.length} sources loaded</span></summary><div className="space-y-4 border-t p-5"><p className="max-w-4xl leading-relaxed text-muted-foreground">Activity uses the selected dates. Receivables, overdue work, product inventory and live-flow counts show the current state. Source attribution uses the saved company source, with combined sources grouped separately.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data.sources.map(source => <div key={source.id} className="flex items-center gap-2">{source.ok ? <Check className="size-3.5 text-emerald-600" /> : <CircleAlert className="size-3.5 text-amber-600" />}<span>{source.label}</span><span className="ml-auto text-muted-foreground">{source.ok ? `${source.count} records` : "Unavailable"}</span></div>)}</div><p className="text-muted-foreground">Snapshot: {data.asOf}. Refresh retrieves the latest saved CRM data. Revenue recognition, historical stage transitions, portal visits and provider delivery rates are not tracked by this report.</p></div></details>
  </div>;
}
