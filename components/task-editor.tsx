"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { followupInstant, followupLocalTime } from "@/lib/company-followup";
import type { ActivityTask } from "@/lib/task-activity";

export function TaskEditor({ task, onClose, onSaved }: { task?: ActivityTask; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [priority, setPriority] = useState(task?.priority ?? "normal");
  const [dueAt, setDueAt] = useState(followupLocalTime(task?.due_at ?? null));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const requestId = useRef<string | null>(null);
  const managedFollowup = task?.notes === "Scheduled from intelligent next follow-up recommendation." || task?.notes?.startsWith("Company purchase analysis:");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setPending(true); setError("");
    requestId.current ??= crypto.randomUUID();
    const fields = { title, ...(managedFollowup ? {} : { notes }), priority, dueAt: dueAt ? followupInstant(dueAt) : null };
    try {
      const response = await fetch("/api/flows/activity", { method: task ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(task ? { kind: "task", id: task.id, expectedUpdatedAt: task.updated_at, changes: fields } : { requestId: requestId.current, task: { op: "create_task", ...fields } }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The task could not be saved.");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The task could not be confirmed. Refresh before retrying."); }
    finally { saving.current = false; setPending(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle><DialogDescription>{task ? "Update your assigned work. Company follow-up dates stay in sync." : "Create a task assigned to you. Add company follow-ups from the company profile."}</DialogDescription></DialogHeader>
    <form onSubmit={save} className="space-y-4">
      <label className="grid gap-1.5 text-sm">Title<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} className="rounded-md border bg-background px-3 py-2" /></label>
      {!managedFollowup ? <label className="grid gap-1.5 text-sm">Notes<textarea maxLength={4000} rows={3} value={notes} onChange={event => setNotes(event.target.value)} className="rounded-md border bg-background px-3 py-2" /></label> : null}
      <label className="grid gap-1.5 text-sm">Priority<select value={priority} onChange={event => setPriority(event.target.value)} className="rounded-md border bg-background px-3 py-2"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
      <label className="grid gap-1.5 text-sm">Due time (your local time)<input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} className="rounded-md border bg-background px-3 py-2" /></label>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Close</Button><Button disabled={pending || !title.trim()}>{pending ? "Saving…" : "Save task"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
