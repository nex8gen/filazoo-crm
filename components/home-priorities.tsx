"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowUpRight, CalendarClock, ListTodo, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NotificationToast } from "@/components/ui/notification-toast";
import { groupHomePriorities, priorityGroups } from "@/lib/home-priorities";
import type { ActivityTask, FlowActivityData } from "@/lib/task-activity";
import { activityTime } from "@/lib/task-activity";
import { useLanguage } from "@/components/language-provider";

const TaskEditor = dynamic(() => import("@/components/task-editor").then(module => module.TaskEditor));

async function fetchPriorities(signal?: AbortSignal): Promise<FlowActivityData> {
  const response = await fetch("/api/tasks?taskView=all&taskScope=mine", { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load priorities.");
  return result;
}

export function HomePriorities({ canManage = false }: { canManage?: boolean }) {
  const { t } = useLanguage();
  const [data, setData] = useState<FlowActivityData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ActivityTask | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await fetchPriorities(signal);
      if (!signal?.aborted) { setData(result); setError(""); }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Unable to load priorities."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  const refresh = () => { setLoading(true); void load(); };
  useEffect(() => {
    const controller = new AbortController();
    void fetchPriorities(controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load priorities."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function complete(task: ActivityTask) {
    setPending(task.id); setError("");
    try {
      const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "task", id: task.id, expectedUpdatedAt: task.updated_at, changes: { status: "done" } }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to complete this task.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to complete this task."); }
    finally { setPending(null); }
  }
  const groups = groupHomePriorities(data?.tasks || [], data?.asOf || new Date().toISOString());
  return <section className="mx-auto w-full max-w-[1000px] space-y-4" aria-labelledby="home-priorities-title" aria-busy={loading}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="home-priorities-title" className="flex items-center gap-2 text-[length:var(--ui-text-heading)] font-medium"><ListTodo className="size-4 text-primary" />{t("Today's priorities")}</h2><div className="flex items-center gap-1"><Button size="icon-sm" variant="ghost" disabled={loading} aria-label={t("Refresh priorities")} onClick={refresh}><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /></Button><Link href="/tasks" className="inline-flex items-center gap-1 text-xs font-medium text-primary">{t("View all tasks")}<ArrowUpRight className="size-3.5" /></Link></div></div>
    {error ? <NotificationToast>{t(error)} <Button variant="ghost" size="sm" onClick={refresh}>{t("Retry")}</Button></NotificationToast> : null}
    {!data && loading ? <div role="status" className="grid gap-4 sm:grid-cols-2">{[0, 1].map(key => <div key={key} className="h-40 animate-pulse rounded-xl border bg-card/60" />)}<span className="sr-only">{t("Loading priorities")}</span></div> : data ? <>
      {data.taskCount > data.tasks.length ? <p className="text-xs text-muted-foreground">{t("Showing the first 100 tasks. Open all tasks to review the full list.")}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">{priorityGroups.map(group => <Card key={group.id} className="gap-3 bg-card/90"><CardHeader className="gap-1 pb-0"><CardTitle className="flex items-center gap-2 text-sm"><span aria-hidden className={`size-2 rounded-full ${group.tone === "rose" ? "bg-rose-500" : group.tone === "amber" ? "bg-amber-500" : group.tone === "green" ? "bg-emerald-500" : "bg-slate-400"}`} />{t(group.label)}<span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">{groups[group.id].length}</span></CardTitle><CardDescription>{t(group.description)}</CardDescription></CardHeader><CardContent className="pb-4">{groups[group.id].length ? <ul className="divide-y">{groups[group.id].slice(0, 4).map(task => <li key={task.id} className="flex items-start gap-2.5 py-3"><Checkbox className="mt-0.5" aria-label={`${t("Complete task")}: ${task.title}`} disabled={Boolean(!canManage || task.workflow || task.automation_id || pending || loading)} onCheckedChange={checked => { if (checked) void complete(task); }} /><div className="min-w-0 flex-1"><Link href={`/tasks?task=${task.id}`} className="block break-words text-xs leading-5 hover:text-primary">{task.title}</Link><p className="mt-0.5 text-[length:var(--ui-text-caption)] leading-4 text-muted-foreground">{task.company?.name}{task.company?.name && task.due_at ? " · " : ""}{task.due_at ? activityTime(task.due_at) : t("No due date")}</p></div><Button size="icon-sm" variant="ghost" aria-label={`${t(group.id === "urgent" ? "Delegate task" : "Schedule task")}: ${task.title}`} title={t(group.id === "urgent" ? "Delegate task" : "Schedule task")} disabled={!canManage || Boolean(pending)} onClick={() => setEditing(task)}>{group.id === "urgent" ? <Users className="size-3.5" /> : <CalendarClock className="size-3.5" />}</Button></li>)}</ul> : <p className="py-5 text-xs text-muted-foreground">{t("No tasks in this group.")}</p>}{groups[group.id].length > 4 ? <Link href="/tasks" className="text-xs text-primary">{t("View all tasks")}</Link> : null}</CardContent></Card>)}</div>
    </> : null}
    {editing ? <TaskEditor task={editing} viewerId={data?.viewerId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
  </section>;
}
