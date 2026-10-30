"use client";

import Link from "next/link";
import { ArrowUpRight, Bell, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ActivityEmptyState, NotificationItem, TaskItem } from "./activity-items";
import type { ActivitySummary, FlowActivityData } from "@/lib/task-activity";

export function FlowActivityBell() {
  const [summary, setSummary] = useState<ActivitySummary>({ openTasks: 0, unreadAlerts: 0, overdueTasks: 0, dueToday: 0 });
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"notifications" | "tasks">("notifications");
  const [activity, setActivity] = useState<FlowActivityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [retry, setRetry] = useState(0);
  const mutation = useRef(0);
  const writing = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false, queued = false;
    let lastRefreshAt: number | null = null;
    const refresh = async (force = false) => {
      if (document.visibilityState === "hidden" || controller.signal.aborted) return;
      if (busy) { if (force) queued = true; return; }
      if (!force && lastRefreshAt !== null && Date.now() - lastRefreshAt < 60_000) return;
      busy = true;
      try {
        const response = await fetch("/api/tasks?summary=1", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json();
        if (!controller.signal.aborted && result.ok) { setSummary(result); lastRefreshAt = Date.now(); }
      } catch { /* The opened inbox exposes retrieval errors and a retry. */ }
      finally { busy = false; if (queued) { queued = false; void refresh(true); } }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    const onUpdated = () => void refresh(true);
    window.addEventListener("focus", onUpdated);
    window.addEventListener("flow-activity-updated", onUpdated);
    window.addEventListener("filazoo:agent-action", onUpdated);
    document.addEventListener("visibilitychange", onUpdated);
    return () => {
      controller.abort(); clearInterval(interval);
      window.removeEventListener("focus", onUpdated);
      window.removeEventListener("flow-activity-updated", onUpdated);
      window.removeEventListener("filazoo:agent-action", onUpdated);
      document.removeEventListener("visibilitychange", onUpdated);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let busy = false, queued = false;
    const refresh = async () => {
      if (controller.signal.aborted || document.visibilityState === "hidden" || writing.current) return;
      if (busy) { queued = true; return; }
      busy = true; setLoading(true);
      const version = mutation.current;
      try {
        const response = await fetch("/api/tasks?preview=1", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load your activity.");
        if (!controller.signal.aborted && version === mutation.current) { setActivity({ ...result, asOf: result.asOf || new Date().toISOString() }); if (result.summary) setSummary(result.summary); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load your activity."); }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false); if (queued) { queued = false; void refresh(); } }
    };
    const onRefresh = () => void refresh();
    void refresh();
    const interval = setInterval(onRefresh, 30_000);
    window.addEventListener("flow-activity-updated", onRefresh);
    window.addEventListener("filazoo:agent-action", onRefresh);
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener("flow-activity-updated", onRefresh); window.removeEventListener("filazoo:agent-action", onRefresh); window.removeEventListener("focus", onRefresh); document.removeEventListener("visibilitychange", onRefresh); };
  }, [open, retry]);

  async function markRead(id: string) {
    if (writing.current) return;
    writing.current = true; mutation.current++; setPending(id); setError("");
    try {
      const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "alert", id }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to update this item.");
      setActivity(current => current ? { ...current, alerts: current.alerts.map(alert => alert.id === id ? { ...alert, read_at: new Date().toISOString() } : alert) } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update this item."); }
    finally { writing.current = false; mutation.current++; setPending(""); window.dispatchEvent(new Event("flow-activity-updated")); }
  }

  const count = summary.unreadAlerts;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger aria-label={`Tasks and notifications${count ? ` (${count} unread)` : ""}`} title="Tasks and notifications" className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border/70 bg-muted/20 px-2 text-muted-foreground outline-none transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:border-primary/15 data-popup-open:bg-primary/7 data-popup-open:text-primary">
      <Bell className="size-4" strokeWidth={1.7} />
      {count > 0 ? <span className="ml-0.5 inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-md bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">{count > 99 ? "99+" : count}</span> : null}
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={12} className="w-[520px] max-w-[calc(100vw-24px)] max-h-[var(--available-height)] gap-0 overflow-hidden rounded-2xl p-0 shadow-[0_12px_48px_-12px_rgb(0_0_0/0.25)] ring-border" onClick={event => { if (event.target instanceof Element && event.target.closest("a")) setOpen(false); }}>
      <div className="flex items-center justify-between gap-3 px-5 pb-5 pt-6 sm:px-6"><div><PopoverTitle className="text-base font-semibold tracking-[-0.006em]">{view === "notifications" ? "Your notifications" : "Your tasks"}</PopoverTitle><PopoverDescription className="sr-only">A quick look at what needs you.</PopoverDescription></div><Link href={view === "tasks" ? "/tasks" : "/tasks?view=notifications"} aria-label={view === "tasks" ? "View all tasks" : "View all notifications"} className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><ArrowUpRight className="size-4" /></Link></div>
      <div className="px-5 pb-4 sm:px-6"><div className="inline-flex max-w-full items-center gap-1 rounded-lg bg-muted/65 p-1" aria-label="Activity views">
        <button type="button" aria-pressed={view === "notifications"} onClick={() => setView("notifications")} className={`inline-flex min-h-8 items-center gap-2 rounded-md px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === "notifications" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Notifications<span className="grid h-5 min-w-5 place-items-center rounded-full bg-muted-foreground/15 px-1 text-[10px] tabular-nums">{activity?.alertCount ?? summary.unreadAlerts}</span></button>
        <button type="button" aria-pressed={view === "tasks"} onClick={() => setView("tasks")} className={`inline-flex min-h-8 items-center gap-2 rounded-md px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === "tasks" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>My tasks<span className="grid h-5 min-w-5 place-items-center rounded-full bg-muted-foreground/15 px-1 text-[10px] tabular-nums">{summary.openTasks}</span></button>
      </div></div>
      {error ? <div role="alert" className="flex items-center justify-between gap-3 border-b bg-destructive/5 px-4 py-3 text-xs text-destructive"><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)} className="shrink-0 rounded p-1 underline focus-visible:outline-2 focus-visible:outline-ring">Try again</button></div> : null}
      <div className="min-h-0 max-h-[min(420px,55dvh)] flex-1 overflow-y-auto overscroll-contain" aria-busy={loading}>
        {!activity && loading ? <div role="status" className="flex min-h-60 items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading activity…</div> : !activity && error ? null : view === "notifications" ? activity?.alerts.length ? <div className="divide-y divide-dashed divide-border">{activity.alerts.slice(0, 5).map(alert => <NotificationItem key={alert.id} alert={alert} now={new Date(activity.asOf ?? "2026-01-01T00:00:00Z")} compact pending={pending === alert.id} disabled={Boolean(pending)} onRead={() => void markRead(alert.id)} onNavigate={() => setOpen(false)} />)}</div> : <ActivityEmptyState kind="notifications" compact /> : activity?.tasks.length ? <div className="divide-y divide-dashed divide-border">{activity.tasks.slice(0, 5).map(task => <TaskItem key={task.id} task={task} now={new Date(activity.asOf ?? "2026-01-01T00:00:00Z")} compact />)}</div> : <ActivityEmptyState kind="tasks" compact />}
      </div>
      <div className="flex items-center justify-between border-t bg-muted/15 px-4 py-3"><button type="button" onClick={() => setRetry(value => value + 1)} disabled={loading} aria-label="Refresh activity" title="Refresh activity" className="grid size-7 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /></button><Link href={view === "tasks" ? "/tasks" : "/tasks?view=notifications"} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">{view === "tasks" ? "View all tasks" : "View all notifications"}<ArrowUpRight className="size-3.5" /></Link></div>
    </PopoverContent>
  </Popover>;
}
