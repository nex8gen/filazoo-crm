"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, ClipboardCheck, Flag, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { followupInstant, followupLocalTime } from "@/lib/company-followup";
import type { ActivityTask, TaskAssignee } from "@/lib/task-activity";
import { TaskAssigneePicker } from "./task-assignee-picker";

export function TaskEditor({ task, viewerId = "", onClose, onSaved }: { task?: ActivityTask; viewerId?: string; onClose: () => void; onSaved: (task?: ActivityTask) => void }) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [priority, setPriority] = useState(task?.priority ?? "normal");
  const [dueAt, setDueAt] = useState(followupLocalTime(task?.due_at ?? null));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<TaskAssignee[]>([]);
  const [memberLoading, setMemberLoading] = useState(true);
  const [memberError, setMemberError] = useState("");
  const [memberRetry, setMemberRetry] = useState(0);
  const [currentUserId, setCurrentUserId] = useState(viewerId);
  const [assignedTo, setAssignedTo] = useState(task?.assigned_to ?? viewerId);
  const saving = useRef(false);
  const requestId = useRef<string | null>(null);
  const managedNotes = task?.notes === "Scheduled from intelligent next follow-up recommendation." || task?.notes?.startsWith("Company purchase analysis:");
  const managedFollowup = task?.follows_company_owner || managedNotes;
  const longContext = Boolean(task && (task.notes?.length ?? 0) > 4000);

  useEffect(() => {
    const controller = new AbortController();
    async function loadMembers() {
      setMemberLoading(true); setMemberError("");
      try {
        const response = await fetch("/api/tasks?members=1", { signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({ ok: false, error: "The task service is unavailable. Reload this page before trying again." }));
        if (!response.ok || !result.ok || !Array.isArray(result.members)) throw new Error(result.error || "Unable to load workspace users.");
        if (controller.signal.aborted) return;
        setMembers(result.members); setCurrentUserId(result.viewerId);
        setAssignedTo(previous => previous || result.viewerId);
      } catch (cause) { if (!controller.signal.aborted) setMemberError(cause instanceof Error ? cause.message : "Unable to load workspace users."); }
      finally { if (!controller.signal.aborted) setMemberLoading(false); }
    }
    void loadMembers();
    return () => controller.abort();
  }, [memberRetry]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setPending(true); setError("");
    requestId.current ??= crypto.randomUUID();
    const fields = { title, ...(managedNotes || (task && notes === (task.notes ?? "")) ? {} : { notes }), priority, ...(!task || followupLocalTime(task.due_at) !== dueAt ? { dueAt: dueAt ? followupInstant(dueAt) : null } : {}) };
    const assignment = assignedTo && (!task || assignedTo !== task.assigned_to) ? { assignedTo } : {};
    try {
      const response = await fetch("/api/tasks", { method: task ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(task ? { kind: "task", id: task.id, expectedUpdatedAt: task.updated_at, changes: fields, ...assignment } : { requestId: requestId.current, task: { op: "create_task", ...fields }, ...assignment }) });
      const result = await response.json().catch(() => ({ ok: false, error: "The task service is unavailable. Reload this page before trying again." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "The task could not be saved.");
      if (result.version !== 2 || !result.task || (assignedTo && result.task.assigned_to !== assignedTo)) throw new Error("The saved assignee could not be confirmed. Refresh tasks before retrying.");
      onSaved(result.task);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The task could not be confirmed. Refresh before retrying."); }
    finally { saving.current = false; setPending(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}><DialogContent className="gap-0 overflow-x-hidden overflow-y-auto rounded-2xl p-0 sm:max-w-[520px]"><DialogHeader className="px-6 pb-5 pt-6"><div className="mb-3 grid size-10 place-items-center rounded-xl border border-primary/10 bg-primary/5 text-primary"><ClipboardCheck className="size-5" strokeWidth={1.6} /></div><DialogTitle className="text-xl tracking-tight">{task ? "Edit task" : "New task"}</DialogTitle><DialogDescription className="mt-1 text-sm leading-6">{"Set an assignee, priority and due date."}</DialogDescription></DialogHeader>
    <form onSubmit={save}>
      <fieldset disabled={pending} className="space-y-5 px-6 pb-6 disabled:opacity-70">
        <label className="grid gap-2 text-xs font-medium">Task title<input autoFocus required maxLength={200} placeholder="What needs to happen?" value={title} onChange={event => setTitle(event.target.value)} className="h-11 rounded-lg border border-border bg-background px-3 text-sm font-normal outline-none placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-2 focus:ring-primary/10" /></label>
        <div className="grid gap-2 text-xs font-medium"><span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5 text-muted-foreground" />Assignee</span>{managedFollowup ? <div className="flex h-11 items-center gap-2 rounded-lg border bg-muted/25 px-3 text-sm font-normal text-muted-foreground"><LockKeyhole className="size-3.5" /><span>{task?.assignee_name || "Follows account owner"}</span></div> : <TaskAssigneePicker members={members} value={assignedTo} viewerId={currentUserId} loading={memberLoading} disabled={pending} onChange={setAssignedTo} />}{memberError ? <p role="alert" className="flex items-center justify-between gap-2 text-xs font-normal text-destructive"><span>{memberError}</span><button type="button" onClick={() => setMemberRetry(value => value + 1)} className="underline">Retry</button></p> : null}</div>
        {!managedNotes ? <label className="grid gap-2 text-xs font-medium"><span className="flex justify-between">Details<span className="font-normal text-muted-foreground">Optional</span></span><textarea placeholder="Add a little context, a link or a reminder…" maxLength={4000} rows={3} readOnly={longContext} value={notes} onChange={event => setNotes(event.target.value)} className="resize-y rounded-lg border bg-background px-3 py-2.5 text-sm font-normal leading-6 outline-none placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-2 focus:ring-primary/10" /></label> : <div className="rounded-lg border border-primary/10 bg-primary/5 px-3 py-2.5 text-xs leading-5 text-muted-foreground">This follow-up stays linked to the company. Date changes sync automatically.</div>}
        <div className="grid gap-4 sm:grid-cols-[140px_1fr]"><label className="grid content-start gap-2 text-xs font-medium"><span className="flex items-center gap-1.5"><Flag className="size-3.5 text-muted-foreground" />Priority</span><select value={priority} onChange={event => setPriority(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label><label className="grid gap-2 text-xs font-medium"><span className="flex items-center gap-1.5"><CalendarClock className="size-3.5 text-muted-foreground" />Due date & time</span><input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" /><span className="text-[10px] font-normal text-muted-foreground">Uses your local time</span></label></div>
        {longContext ? <p className="text-xs leading-5 text-muted-foreground">System context is preserved. You can update the task without changing its saved evidence.</p> : null}
        {error ? <p role="alert" className="rounded-lg border border-destructive/15 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-6 py-4"><span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><UserRound className="size-3.5" /><span>{assignedTo === currentUserId ? "Assigned to you" : "Assigned to a teammate"}</span></span><div className="flex gap-2"><Button size="sm" type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={pending || !title.trim() || memberLoading || !assignedTo}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{pending ? "Saving…" : task ? "Save changes" : "Create task"}</Button></div></div>
    </form>
  </DialogContent></Dialog>;
}
