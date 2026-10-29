"use client";

import Link from "next/link";
import { Bell, ListTodo } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmailAutoReplyControl } from "@/components/email-auto-reply-control";
import { EmptyState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { flowConversationPath } from "@/lib/flow-engine";
import { activityPageSize, activityTime, type ActivityTask, type FlowActivityData } from "@/lib/task-activity";
import { TaskEditor } from "./task-editor";

export type { FlowActivityData } from "@/lib/task-activity";
export { FlowActivityBell } from "./flow-activity-bell";

function Pagination({ page, count, disabled, onChange }: { page: number; count: number; disabled: boolean; onChange: (page: number) => void }) {
  if (count <= activityPageSize && page === 0) return null;
  return <div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={disabled || page === 0} onClick={() => onChange(page - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page + 1} of {Math.max(1, Math.ceil(count / activityPageSize))}</span><Button size="sm" variant="outline" disabled={disabled || (page + 1) * activityPageSize >= count} onClick={() => onChange(page + 1)}>Next</Button></div>;
}

export function FlowActivity({ initial, canManage = true, taskId }: { initial: FlowActivityData; canManage?: boolean; taskId?: string }) {
  const [activity, setActivity] = useState(initial);
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
    const controller = new AbortController();
    let busy = false, queued = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || controller.signal.aborted || writing.current) return;
      if (busy) { queued = true; return; }
      busy = true; setRefreshing(true);
      const version = revision.current;
      try {
        const response = await fetch(`/api/flows/activity?taskPage=${taskPage}&alertPage=${alertPage}${taskId ? `&task=${encodeURIComponent(taskId)}` : ""}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Unable to refresh activity.");
        if (!controller.signal.aborted && version === revision.current) {
          setActivity(result); setSyncError("");
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
    const interval = setInterval(onRefresh, 15_000);
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
  }, [taskPage, alertPage, taskId]);

  async function update(kind: "task" | "alert", id: string, task?: ActivityTask, status = "done") {
    if (writing.current) return;
    writing.current = true; revision.current++; setPending(id); setError("");
    try {
      const response = await fetch("/api/flows/activity", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, ...(task ? { expectedUpdatedAt: task.updated_at, changes: { status } } : {}) }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to update this item.");
      setActivity(current => kind === "task" ? { ...current, tasks: current.tasks.filter(item => item.id !== id) } : { ...current, alerts: current.alerts.map(alert => alert.id === id ? { ...alert, read_at: new Date().toISOString() } : alert) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update this item."); }
    finally {
      writing.current = false; revision.current++; setPending("");
      window.dispatchEvent(new Event("flow-activity-updated"));
    }
  }

  const paging = activity.taskPage !== taskPage || activity.alertPage !== alertPage;
  const displayTasks = activity.focusedTask && !activity.tasks.some(task => task.id === activity.focusedTask?.id) ? [activity.focusedTask, ...activity.tasks] : activity.tasks;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Times shown in UTC+8. Due reminders appear in the notification bell.</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={refreshing || Boolean(pending)} onClick={() => window.dispatchEvent(new Event("flow-activity-updated"))}>{refreshing ? "Refreshing…" : "Refresh"}</Button>{canManage ? <Button size="sm" onClick={() => setEditor("new")}>New task</Button> : null}</div></div>
    {error || syncError ? <p role="alert" className="text-sm text-destructive">{error || syncError}{syncError ? " Showing the last available activity." : ""}</p> : null}
    {editor ? <TaskEditor key={editor === "new" ? "new" : editor.id} task={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { revision.current++; setEditor(null); setTaskPage(0); window.dispatchEvent(new Event("flow-activity-updated")); }} /> : null}
    <div className="grid gap-6 lg:grid-cols-2" aria-busy={refreshing}>
      <section aria-labelledby="flow-tasks" className="space-y-3"><h2 id="flow-tasks" className="font-semibold">Your open tasks ({activity.taskCount})</h2><p className="text-xs text-muted-foreground">Earliest due first. Company and product follow-ups link back to the customer.</p>
        {taskId && !activity.focusedTask ? <p role="status" className="text-sm text-muted-foreground">The selected task is unavailable or belongs to another teammate.</p> : null}
        {!displayTasks.length ? <EmptyState compact icon={ListTodo} title="No open tasks on this page." /> : displayTasks.map(task => <article id={`task-${task.id}`} key={task.id} className="scroll-mt-20 space-y-3 rounded-lg border p-4">
          <div>{task.id === taskId ? <p className="text-xs font-medium text-primary">Selected task · {task.status}</p> : null}<p className="font-medium">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{task.priority} priority{task.due_at ? ` · Due ${activityTime(task.due_at)}` : " · No due date"}</p></div>
          {task.notes ? <p className="whitespace-pre-wrap break-words text-sm">{task.notes}</p> : null}
          {task.automation_id && canManage && task.status === "open" ? <EmailAutoReplyControl automationId={task.automation_id} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            {canManage && !task.automation_id && task.status === "open" ? <><Button size="sm" variant="outline" disabled={Boolean(pending) || paging} onClick={() => void update("task", task.id, task)}>{pending === task.id ? "Saving…" : "Mark complete"}</Button><Button size="sm" variant="ghost" disabled={Boolean(pending) || paging} onClick={() => setEditor(task)}>Edit</Button><Button size="sm" variant="ghost" disabled={Boolean(pending) || paging} onClick={() => void update("task", task.id, task, "cancelled")}>Cancel task</Button></> : null}
            {task.company_id ? <Link href={`/companies/${task.company_id}`} className="text-sm text-primary underline">Open company</Link> : null}
          </div>
        </article>)}
        <Pagination page={taskPage} count={activity.taskCount} disabled={refreshing || Boolean(pending) || paging} onChange={setTaskPage} />
      </section>
      <section aria-labelledby="flow-alerts" className="space-y-3"><h2 id="flow-alerts" className="font-semibold">Your notifications ({activity.alertCount})</h2><p className="text-xs text-muted-foreground">Unread notifications first, newest first within each group.</p>
        {!activity.alerts.length ? <EmptyState compact icon={Bell} title="No notifications on this page." /> : activity.alerts.map(alert => <article key={alert.id} className={`space-y-3 rounded-lg border p-4 ${alert.read_at ? "" : "bg-primary/5"}`}>
          <p className="whitespace-pre-wrap break-words text-sm">{alert.message}</p><p className="text-xs text-muted-foreground">{activityTime(alert.created_at)}</p>
          <div className="flex flex-wrap items-center gap-3">{!alert.read_at ? <Button size="sm" variant="outline" disabled={Boolean(pending) || paging} onClick={() => void update("alert", alert.id)}>{pending === alert.id ? "Saving…" : "Mark read"}</Button> : <span className="text-xs text-muted-foreground">Read</span>}
            {alert.task_id ? <Link href={`/tasks?task=${encodeURIComponent(alert.task_id)}`} className="text-sm text-primary underline">Open task</Link> : alert.include_thread_link && alert.conversation_id ? <Link href={flowConversationPath(alert.conversation_id)} className="text-sm text-primary underline">Open conversation</Link> : null}
          </div>
        </article>)}
        <Pagination page={alertPage} count={activity.alertCount} disabled={refreshing || Boolean(pending) || paging} onChange={setAlertPage} />
      </section>
    </div>
  </div>;
}
