"use client";
import { useWorkspaceState } from "@/components/workspace-memory";

import Link from "next/link";
import { ArrowUpRight, CalendarDays, CheckCheck, ClipboardList, Clock3, MessageSquareText, ReceiptText, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/components/language-provider";
import { type MyDayData, type MyDayItem, type MyDayKind } from "@/lib/my-day";

const kinds: { id: MyDayKind | "all"; label: string }[] = [{ id: "all", label: "All work" }, { id: "task", label: "Tasks" }, { id: "reply", label: "Customer replies" }, { id: "followup", label: "Follow-ups" }, { id: "payment", label: "Payments" }];
const icons = { task: ClipboardList, reply: MessageSquareText, followup: CalendarDays, payment: ReceiptText };
const urgencyLabels = { overdue: "Overdue", today: "Today", attention: "Needs attention", upcoming: "Upcoming" };

function WorkItem({ item, locale }: { item: MyDayItem; locale: string }) {
  const Icon = icons[item.kind];
  const date = item.dueAt ? new Date(item.dueAt) : null;
  return <li className="flex gap-3 border-b border-border/70 p-4 last:border-b-0 sm:gap-4 sm:p-5">
    <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${item.urgency === "overdue" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-primary/8 text-primary"}`}><Icon className="size-4" aria-hidden="true" /></div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{kinds.find(kind => kind.id === item.kind)?.label}</span><span className={`rounded-md px-1.5 py-0.5 text-[10px] ${item.urgency === "overdue" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>{urgencyLabels[item.urgency]}</span></div>
      <Link href={item.href} className="mt-1 block break-words text-sm font-semibold hover:text-primary" data-no-translate={item.id.startsWith("task:") || undefined}>{item.title}</Link>
      {item.company ? <p className="mt-0.5 break-words text-xs text-muted-foreground" data-no-translate>{item.company}</p> : null}
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.reason}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">{date && Number.isFinite(date.getTime()) ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock3 className="size-3" aria-hidden="true" /><time dateTime={item.dueAt!}>{new Intl.DateTimeFormat(locale, { timeZone: "Asia/Shanghai", month: "short", day: "numeric", ...(item.kind !== "payment" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}) }).format(date)}</time></span> : null}
        {item.amount ? <span className="font-medium tabular-nums" data-no-translate>{new Intl.NumberFormat(locale, { style: "currency", currency: /^[A-Z]{3}$/.test(item.amount.currency) ? item.amount.currency : "USD" }).format(item.amount.minor / 100)}</span> : null}
        <Link href={item.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">{item.action}<ArrowUpRight className="size-3" aria-hidden="true" /></Link>
      </div>
    </div>
  </li>;
}

export function MyDayWorkspace({ initial }: { initial: MyDayData }) {
  const [data, setData] = useState(initial);
  const [kind, setKind] = useWorkspaceState<MyDayKind | "all">("my-day.kind", "all");
  const [query, setQuery] = useWorkspaceState("my-day.query", "");
  const [includeUpcoming, setIncludeUpcoming] = useWorkspaceState("my-day.upcoming", false);
  const [limit, setLimit] = useWorkspaceState("my-day.limit", 25);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const { language } = useLanguage();
  const locale = language === "zh-CN" ? "zh-CN" : "en-GB";
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; setRefreshing(true);
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch("/api/my-day", { cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.items) || !Array.isArray(result.sources)) throw new Error("Unable to refresh My Day. Showing the last available work.");
      if (!request.signal.aborted) { setData(result); setError(""); }
    } catch {
      if (!request.signal.aborted) setError("Unable to refresh My Day. Showing the last available work.");
    } finally {
      pending.current = false;
      if (!request.signal.aborted) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const onRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    onRefresh();
    const timer = window.setInterval(onRefresh, 60_000);
    window.addEventListener("focus", onRefresh);
    window.addEventListener("flow-activity-updated", onRefresh);
    window.addEventListener("filazoo:agent-action", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => { window.clearInterval(timer); controller.current?.abort(); window.removeEventListener("focus", onRefresh); window.removeEventListener("flow-activity-updated", onRefresh); window.removeEventListener("filazoo:agent-action", onRefresh); document.removeEventListener("visibilitychange", onRefresh); };
  }, [refresh]);
  const active = data.items.filter(item => item.urgency !== "upcoming");
  const filtered = data.items.filter(item => (includeUpcoming || item.urgency !== "upcoming") && (kind === "all" || kind === item.kind) && `${item.title} ${item.company ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const unavailable = data.sources.filter(source => !source.ok);
  const stats = [{ label: "Needs action", count: active.length }, { label: "Overdue", count: active.filter(item => item.urgency === "overdue").length }, { label: "Customer replies", count: active.filter(item => item.kind === "reply").length }, { label: "Payments due", count: active.filter(item => item.kind === "payment").length }];
  return <div className="mx-auto max-w-5xl space-y-6 pb-8">
    <header className="flex items-start justify-between gap-4"><div><p className="mb-2 text-xs text-muted-foreground"><time dateTime={data.asOf}>{new Intl.DateTimeFormat(locale, { timeZone: "Asia/Shanghai", weekday: "long", month: "long", day: "numeric" }).format(new Date(data.asOf))}</time></p><h1 className="text-3xl font-semibold tracking-tight">My Day</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Your work, customer follow-ups and payments in one place.</p></div><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />Refresh</Button></header>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{stats.map(stat => <div key={stat.label} className="rounded-2xl border bg-card p-4 sm:p-5"><p className="text-xs text-muted-foreground">{stat.label}</p><p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{stat.count}</p></div>)}</div>
    {error || unavailable.length ? <div role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs leading-5"><p>{error || "Some work could not be loaded. This list may be incomplete."}</p>{unavailable.length ? <ul className="mt-1 list-inside list-disc">{unavailable.map(source => <li key={source.id}>{source.label}</li>)}</ul> : null}<button type="button" className="mt-2 font-medium underline" onClick={() => void refresh()} disabled={refreshing}>Try again</button></div> : null}
    <section className="overflow-hidden rounded-2xl border bg-card" aria-label="Daily work list">
      <div className="space-y-4 border-b p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Your next actions</h2><Link href="/tasks" className="text-xs text-primary hover:underline">All tasks and notifications</Link></div><nav className="flex flex-wrap gap-1" aria-label="Work type">{kinds.map(filter => <button key={filter.id} type="button" aria-pressed={filter.id === kind} onClick={() => { setKind(filter.id); setLimit(25); }} className={`rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring ${kind === filter.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>{filter.label}</button>)}</nav>
        <div className="flex flex-wrap items-center gap-3"><div className="relative min-w-44 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input type="search" aria-label="Search your daily work" placeholder="Search your daily work" value={query} onChange={event => { setQuery(event.target.value); setLimit(25); }} className="h-9 pl-9 text-xs" /></div><label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={includeUpcoming} onChange={event => { setIncludeUpcoming(event.target.checked); setLimit(25); }} className="accent-primary" />Include upcoming</label></div>
      </div>
      {filtered.length ? <ul aria-label="Priority work">{filtered.slice(0, limit).map(item => <WorkItem key={item.id} item={item} locale={locale} />)}</ul> : <div className="px-6 py-14 text-center"><CheckCheck className="mx-auto mb-4 size-7 text-primary" aria-hidden="true" /><p className="text-sm font-medium">{query || kind !== "all" ? "No work matches these filters." : unavailable.length ? "No work is available from the loaded sources." : "You are up to date for today."}</p><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{query || kind !== "all" ? "Try another search or work type." : "New tasks, customer follow-ups and payment reviews will appear here."}</p></div>}
      {filtered.length > limit ? <div className="border-t p-4 text-center"><Button variant="outline" size="sm" onClick={() => setLimit(current => current + 25)}>Show more</Button></div> : null}
    </section>
    <p className="text-xs leading-5 text-muted-foreground">Overdue work comes first, followed by work due today and items needing review. Within each group, customer replies and high-priority tasks come first. Times use UTC+8. Only work assigned to you, your customer follow-ups and relevant invoices are included.</p>
  </div>;
}
