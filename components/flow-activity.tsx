"use client";

import { Bell, CheckCheck, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { activityPageSize, taskDueGroup, type ActivityTask, type FlowActivityData, type TaskView } from "@/lib/task-activity";
import { TaskEditor } from "./task-editor";
import { ActivityEmptyState, NotificationItem, TaskItem } from "./activity-items";

export type { FlowActivityData } from "@/lib/task-activity";
export { FlowActivityBell } from "./flow-activity-bell";

const taskFilters: { value: TaskView; label: string }[] = [
  { value: "all", label: "All open" }, { value: "today", label: "Due today" }, { value: "overdue", label: "Overdue" }, { value: "upcoming", label: "Upcoming" }, { value: "completed", label: "Completed" },
];

function Pagination({ page, count, disabled, onChange }: { page: number; count: number; disabled: boolean; onChange: (page: number) => void }) {
  if (count <= activityPageSize && page === 0) return null;
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3"><span className="text-xs text-muted-foreground">Page {page + 1} of {Math.max(1, Math.ceil(count / activityPageSize))}</span><div className="flex gap-1.5"><Button size="sm" variant="outline" disabled={disabled || page === 0} onClick={() => onChange(page - 1)}><ChevronLeft className="size-3.5" />Previous</Button><Button size="sm" variant="outline" disabled={disabled || (page + 1) * activityPageSize >= count} onClick={() => onChange(page + 1)}>Next<ChevronRight className="size-3.5" /></Button></div></div>;
}

export function FlowActivity({ initial, canManage = true, taskId, initialView = "tasks", customerReplies }: { initial: FlowActivityData; canManage?: boolean; taskId?: string; initialView?: "tasks" | "notifications" | "replies"; customerReplies?: React.ReactNode }) {
  const [activity, setActivity] = useState(initial);
  const [referenceTime] = useState(() => initial.asOf ?? new Date().toISOString());
  const [view, setView] = useState(initialView);
  const [taskView, setTaskView] = useState<TaskView>("all");
  const [taskScope, setTaskScope] = useState<"mine" | "delegated">("mine");
  const [alertView, setAlertView] = useState<"all" | "unread">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [taskPage, setTaskPage] = useState(0);
  const [alertPage, setAlertPage] = useState(0);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState<ActivityTask | "new" | null>(null);
  const revision = useRef(0);
  const writing = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setTaskPage(0); setAlertPage(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false, queued = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || controller.signal.aborted || writing.current) return;
      if (busy) { queued = true; return; }
      busy = true; setRefreshing(true);
      const version = revision.current;
      try {
        const params = new URLSearchParams({ taskPage: String(taskPage), alertPage: String(alertPage), taskView, alertView, query, taskScope });
        if (taskId) params.set("task", taskId);
        const response = await fetch(`/api/tasks?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({ ok: false, error: "Unable to load tasks and notifications. Please reload this page." }));
        if (!response.ok || !result.ok) throw new Error(result.error || "Unable to refresh activity.");
        if (!Array.isArray(result.tasks) || !Array.isArray(result.alerts)) throw new Error("Unable to refresh activity. Please reload this page.");
        if (result.version !== 2 && (taskScope !== "mine" || taskView !== "all" || alertView !== "all" || query)) throw new Error("The CRM was updated. Reload this page to load the latest task tools.");
        if (!controller.signal.aborted && version === revision.current) {
          setActivity({ ...result, asOf: result.asOf || new Date().toISOString() }); setSyncError("");
          if (taskPage > 0 && taskPage * activityPageSize >= result.taskCount) setTaskPage(Math.max(0, Math.ceil(result.taskCount / activityPageSize) - 1));
          if (alertPage > 0 && alertPage * activityPageSize >= result.alertCount) setAlertPage(Math.max(0, Math.ceil(result.alertCount / activityPageSize) - 1));
        }
      } catch (cause) {
        if (!controller.signal.aborted) setSyncError(cause instanceof Error ? cause.message : "Unable to refresh activity.");
      } finally {
        busy = false;
        if (!controller.signal.aborted) setRefreshing(false);
        if (queued) { queued = false; void refresh(); }
      }
    };
    const onRefresh = () => void refresh();
    void refresh();
    const interval = setInterval(onRefresh, 30_000);
    window.addEventListener("flow-activity-updated", onRefresh);
    window.addEventListener("filazoo:agent-action", onRefresh);
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      controller.abort(); clearInterval(interval);
      window.removeEventListener("flow-activity-updated", onRefresh);
      window.removeEventListener("filazoo:agent-action", onRefresh);
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, [taskPage, alertPage, taskId, taskView, alertView, query, taskScope]);

  async function update(kind: "task" | "alert", id: string, task?: ActivityTask, status = "done") {
    if (writing.current) return;
    writing.current = true; revision.current++; setPending(id); setError("");
    try {
      const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, ...(task ? { expectedUpdatedAt: task.updated_at, changes: { status } } : {}) }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to update this item.");
      setActivity(current => kind === "task" ? { ...current, tasks: current.tasks.filter(item => item.id !== id), focusedTask: current.focusedTask?.id === id ? { ...current.focusedTask, status } : current.focusedTask } : { ...current, alerts: current.alerts.map(alert => alert.id === id ? { ...alert, read_at: new Date().toISOString() } : alert) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update this item."); }
    finally {
      writing.current = false; revision.current++; setPending("");
      window.dispatchEvent(new Event("flow-activity-updated"));
    }
  }

  const now = new Date(activity.asOf ?? referenceTime);
  const summary = activity.summary ?? { openTasks: activity.taskCount, unreadAlerts: activity.alerts.filter(alert => !alert.read_at).length, overdueTasks: 0, dueToday: 0 };
  const paging = activity.taskPage !== taskPage || activity.alertPage !== alertPage || (activity.taskView ?? "all") !== taskView || (activity.alertView ?? "all") !== alertView || (activity.query ?? "") !== query || (activity.taskScope ?? "mine") !== taskScope;
  const disabled = Boolean(pending) || paging;
  const filtered = Boolean(query) || (view === "tasks" ? taskView !== "all" && taskView !== "completed" : alertView === "unread");
  const currentTasks = activity.tasks.filter(task => task.id !== taskId);
  const groups = new Map<string, ActivityTask[]>();
  for (const task of currentTasks) { const group = taskDueGroup(task, now); groups.set(group, [...(groups.get(group) ?? []), task]); }
  const chooseTaskView = (next: TaskView) => { setTaskView(next); setTaskPage(0); };
  const clearFilters = () => { setSearch(""); setQuery(""); chooseTaskView("all"); setAlertView("all"); setAlertPage(0); };

  return <div className="@container mx-auto max-w-[960px] space-y-6 pb-6">
    <header className="flex flex-wrap items-start justify-between gap-5">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.035em] sm:text-[30px]">Tasks and notifications</h1>
      <div className="flex items-center gap-2 pt-1"><Button size="icon-sm" variant="outline" aria-label="Refresh activity" title="Refresh activity" disabled={refreshing || Boolean(pending)} onClick={() => window.dispatchEvent(new Event("flow-activity-updated"))}><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} /></Button>{canManage ? <Button size="sm" onClick={() => setEditor("new")}><Plus className="size-4" />New task</Button> : null}</div>
    </header>
    {view !== "replies" && (error || syncError) ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive"><p>{error || syncError}{syncError ? " Showing the last available activity." : ""}</p><Button size="xs" variant="ghost" onClick={() => window.dispatchEvent(new Event("flow-activity-updated"))}>Try again</Button></div> : null}
    {editor ? <TaskEditor key={editor === "new" ? "new" : editor.id} task={editor === "new" ? undefined : editor} viewerId={activity.viewerId} onClose={() => setEditor(null)} onSaved={saved => { revision.current++; setEditor(null); setView("tasks"); setTaskScope(saved?.assigned_to && saved.assigned_to !== activity.viewerId ? "delegated" : "mine"); clearFilters(); window.dispatchEvent(new Event("flow-activity-updated")); }} /> : null}
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_2px_8px_-5px_rgb(0_0_0/0.12)]" aria-label="Work inbox">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-b px-4 pt-2 sm:px-5">
        <nav aria-label="Activity views" className="flex min-w-0 w-full gap-2 @xl:w-auto @xl:gap-5"><button type="button" onClick={() => setView("tasks")} aria-pressed={view === "tasks"} className={`relative inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1 border-b-2 px-0.5 text-xs @xl:flex-none @xl:gap-2 outline-none sm:text-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${view === "tasks" ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><ClipboardCheck aria-hidden="true" className="hidden size-4 @xl:block" />Tasks<span className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${view === "tasks" ? "bg-primary/8 text-primary" : "bg-muted"}`}>{activity.taskCount}</span></button><button type="button" onClick={() => setView("notifications")} aria-pressed={view === "notifications"} className={`relative inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1 border-b-2 px-0.5 text-xs @xl:flex-none @xl:gap-2 outline-none sm:text-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${view === "notifications" ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Bell aria-hidden="true" className="hidden size-4 @xl:block" />Notifications{summary.unreadAlerts > 0 ? <span className="rounded-md bg-primary/8 px-1.5 py-0.5 text-[10px] text-primary tabular-nums">{summary.unreadAlerts}</span> : null}</button>{customerReplies ? <button type="button" onClick={() => setView("replies")} aria-pressed={view === "replies"} className={`min-h-12 min-w-0 flex-1 border-b-2 px-0.5 text-xs @xl:flex-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:text-sm ${view === "replies" ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>Customer replies</button> : null}</nav>
        <div className="mb-2 hidden items-center gap-1.5 text-[10px] sm:flex text-muted-foreground"><span className={`size-1.5 rounded-full ${syncError ? "bg-amber-500" : "bg-primary"}`} /><span>{syncError ? "Sync paused" : "Auto-updating"}</span></div>
      </div>
      {view !== "replies" ? <div className="flex flex-col gap-3 border-b bg-muted/15 @4xl:flex-row @4xl:items-center @4xl:justify-between px-4 py-3 sm:px-5">
        <div className="flex max-w-full flex-wrap gap-1" aria-label={view === "tasks" ? "Task filters" : "Notification filters"}>
          {view === "tasks" ? taskFilters.map(filter => <button type="button" key={filter.value} aria-pressed={taskView === filter.value} onClick={() => chooseTaskView(filter.value)} className={`min-h-8 rounded-lg px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${taskView === filter.value ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border/80" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{filter.label}</button>) : ([{ value: "all", label: "All updates" }, { value: "unread", label: "Unread" }] as const).map(filter => <button type="button" key={filter.value} aria-pressed={alertView === filter.value} onClick={() => { setAlertView(filter.value); setAlertPage(0); }} className={`min-h-8 rounded-lg px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${alertView === filter.value ? "bg-background font-medium shadow-sm ring-1 ring-border/80" : "text-muted-foreground hover:bg-muted"}`}>{filter.label}</button>)}
        </div>
        <div className="flex min-w-0 w-full items-center justify-end gap-2 @4xl:w-auto @4xl:flex-1">{view === "tasks" ? <select aria-label="Task assignment" value={taskScope} onChange={event => { setTaskScope(event.target.value as "mine" | "delegated"); setTaskPage(0); }} className="h-8 max-w-full rounded-lg border border-border/80 bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="mine">Assigned to me</option><option value="delegated">Assigned by me</option></select> : null}<div className="relative min-w-0 flex-1 @4xl:basis-44 @4xl:max-w-60"><Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><input type="search" aria-label={view === "tasks" ? "Search task titles" : "Search notifications"} placeholder={view === "tasks" ? "Search tasks…" : "Search notifications…"} value={search} maxLength={120} onChange={event => setSearch(event.target.value)} className="h-8 w-full rounded-lg border border-border/80 bg-background pl-8 pr-8 text-xs outline-none placeholder:text-muted-foreground/75 focus:border-primary/40 focus:ring-2 focus:ring-primary/10 [&::-webkit-search-cancel-button]:appearance-none" />{search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-1 top-0.5 grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button> : null}</div>
        </div>
      </div> : null}
      <div aria-busy={view !== "replies" && refreshing} className={view !== "replies" && paging ? "pointer-events-none opacity-50" : ""}>
        {view === "replies" ? customerReplies : view === "tasks" ? <>
          {taskId ? <div className="border-b"><p className="bg-primary/5 px-5 py-2 text-[10px] font-semibold tracking-wide text-primary">Selected task</p>{activity.focusedTask ? <TaskItem task={activity.focusedTask} now={now} selected canManage={canManage} disabled={disabled} pending={pending === activity.focusedTask.id} onComplete={() => void update("task", activity.focusedTask!.id, activity.focusedTask!)} onEdit={() => setEditor(activity.focusedTask!)} onCancel={() => void update("task", activity.focusedTask!.id, activity.focusedTask!, "cancelled")} /> : <p role="status" className="px-5 py-4 text-sm text-muted-foreground">The selected task is unavailable or belongs to another teammate.</p>}</div> : null}
          {!activity.tasks.length ? <ActivityEmptyState kind="tasks" filtered={filtered} completed={taskView === "completed"} canCreate={canManage} onCreate={() => setEditor("new")} onClear={clearFilters} /> : <div>{[...groups].map(([group, tasks]) => <section key={group} aria-label={group}><div className="flex items-center gap-2 border-b bg-muted/20 px-5 py-2.5 text-[10px] font-medium text-muted-foreground">{group === "Overdue" ? <Clock3 className="size-3 text-amber-600" /> : group === "Completed" ? <CheckCheck className="size-3 text-primary" /> : null}<span className={group === "Overdue" ? "text-amber-700 dark:text-amber-400" : ""}>{group}</span><span className="tabular-nums text-muted-foreground/60">{tasks.length}</span></div><div className="divide-y divide-dashed divide-border">{tasks.map(task => <TaskItem key={task.id} task={task} now={now} showAssignee={taskScope === "delegated"} canManage={canManage} pending={pending === task.id} disabled={disabled} onComplete={() => void update("task", task.id, task)} onEdit={() => setEditor(task)} onCancel={() => void update("task", task.id, task, "cancelled")} />)}</div></section>)}</div>}
          <Pagination page={taskPage} count={activity.taskCount} disabled={refreshing || disabled} onChange={setTaskPage} />
        </> : <>
          {!activity.alerts.length ? <ActivityEmptyState kind="notifications" filtered={filtered} onClear={clearFilters} /> : <div className="divide-y divide-dashed divide-border">{activity.alerts.map(alert => <NotificationItem key={alert.id} alert={alert} now={now} disabled={disabled} pending={pending === alert.id} onRead={() => void update("alert", alert.id)} />)}</div>}
          <Pagination page={alertPage} count={activity.alertCount} disabled={refreshing || disabled} onChange={setAlertPage} />
        </>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-5 py-3 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Clock3 className="size-3" aria-hidden="true" /><span>All times in UTC+8</span></span><span className="inline-flex items-center gap-1.5">{refreshing ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin" /> : <CheckCheck aria-hidden="true" className="size-3" />}<span>{refreshing ? "Updating your workspace…" : "Your work stays in sync"}</span></span></footer>
    </section>
  </div>;
}
