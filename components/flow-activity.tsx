"use client";

import { ListTodo } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { flowConversationPath } from "@/lib/flow-engine";

type Task = { id: string; title: string; notes: string | null; priority: string; due_at: string | null; company_id: string | null };
type Alert = { id: string; message: string; channel: string; conversation_id: string | null; include_thread_link: boolean; read_at: string | null; created_at: string };
export type FlowActivityData = { tasks: Task[]; alerts: Alert[] };
const activityTime = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));

export function FlowActivityBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/flows/activity?summary=1", { signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json();
        if (!controller.signal.aborted && result.ok) setCount(result.openTasks + result.unreadAlerts);
      } catch { /* The activity page displays retrieval errors. */ }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("flow-activity-updated", refresh);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener("focus", refresh); window.removeEventListener("flow-activity-updated", refresh); };
  }, []);
  return <Link href="/tasks" aria-label={`Tasks and notifications${count ? ` (${count} pending)` : ""}`} className="relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Bell className="size-4" />{count > 0 ? <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{count > 99 ? "99+" : count}</span> : null}</Link>;
}

export function FlowActivity({ initial }: { initial: FlowActivityData }) {
  const [activity, setActivity] = useState(initial);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  async function complete(kind: "task" | "alert", id: string) {
    setPending(id); setError("");
    try {
      const response = await fetch("/api/flows/activity", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to update this item.");
      setActivity(current => kind === "task" ? { ...current, tasks: current.tasks.filter(task => task.id !== id) } : { ...current, alerts: current.alerts.map(alert => alert.id === id ? { ...alert, read_at: new Date().toISOString() } : alert) });
      window.dispatchEvent(new Event("flow-activity-updated"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update this item."); }
    finally { setPending(""); }
  }
  return <div className="space-y-5"><p className="text-xs text-muted-foreground">Times shown in UTC+8.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="flow-tasks" className="space-y-3"><h2 id="flow-tasks" className="font-semibold">Your open tasks</h2><p className="text-xs text-muted-foreground">Up to 100 tasks, earliest due first.</p>{!activity.tasks.length ? <EmptyState compact icon={ListTodo} title="No open tasks assigned to you." /> : activity.tasks.map(task => <article key={task.id} className="space-y-3 rounded-lg border p-4"><div><p className="font-medium">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{task.priority} priority{task.due_at ? ` · Due ${activityTime(task.due_at)}` : ""}</p></div>{task.notes ? <p className="whitespace-pre-wrap break-words text-sm">{task.notes}</p> : null}<div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={Boolean(pending)} onClick={() => void complete("task", task.id)}>{pending === task.id ? "Saving…" : "Mark complete"}</Button>{task.company_id ? <Link href={`/companies/${task.company_id}`} className="text-sm text-primary underline">Open company</Link> : null}</div></article>)}</section>
      <section aria-labelledby="flow-alerts" className="space-y-3"><h2 id="flow-alerts" className="font-semibold">Your notifications</h2><p className="text-xs text-muted-foreground">100 most recent notifications.</p>{!activity.alerts.length ? <EmptyState compact icon={Bell} title="No notifications yet." /> : activity.alerts.map(alert => <article key={alert.id} className={`space-y-3 rounded-lg border p-4 ${alert.read_at ? "" : "bg-primary/5"}`}><p className="whitespace-pre-wrap break-words text-sm">{alert.message}</p><p className="text-xs text-muted-foreground">{activityTime(alert.created_at)}</p><div className="flex items-center gap-3">{!alert.read_at ? <Button size="sm" variant="outline" disabled={Boolean(pending)} onClick={() => void complete("alert", alert.id)}>{pending === alert.id ? "Saving…" : "Mark read"}</Button> : <span className="text-xs text-muted-foreground">Read</span>}{alert.include_thread_link && alert.conversation_id ? <Link href={flowConversationPath(alert.conversation_id)} className="text-sm text-primary underline">Open conversation</Link> : null}</div></article>)}</section>
    </div>
  </div>;
}
