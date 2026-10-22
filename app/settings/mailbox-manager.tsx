"use client";

import { useActionState, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { manageMailbox } from "./actions";

type MailboxSummary = {
  id: string;
  email: string;
  type: "workspace" | "personal";
  isDefault: boolean;
  isActive: boolean;
};

export function MailboxManager({ mailbox }: { mailbox: MailboxSummary }) {
  const [state, action, pending] = useActionState(manageMailbox, undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="space-y-3 rounded-md border px-3 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all font-medium text-foreground">{mailbox.email}</p>
          <p className="mt-1 text-muted-foreground">{mailbox.type === "workspace" ? "Common mailbox" : "Personal mailbox"}{mailbox.isDefault ? " · default" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{mailbox.type}</Badge>
          <Badge variant={mailbox.isActive ? "secondary" : "outline"}>{mailbox.isActive ? "Active" : "Stopped"}</Badge>
          <form action={action}>
            <input type="hidden" name="mailboxId" value={mailbox.id} />
            <Button type="submit" name="operation" value={mailbox.isActive ? "stop" : "resume"} variant="outline" size="sm" disabled={pending} aria-label={`${mailbox.isActive ? "Stop" : "Resume"} ${mailbox.email}`}>
              {mailbox.isActive ? <Pause /> : <Play />}{mailbox.isActive ? "Stop" : "Resume"}
            </Button>
          </form>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setConfirmDelete(true)} aria-label={`Delete ${mailbox.email}`}><Trash2 />Delete</Button>
        </div>
      </div>
      {confirmDelete ? (
        <form action={action} className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <input type="hidden" name="mailboxId" value={mailbox.id} />
          <input type="hidden" name="operation" value="delete" />
          <p>Delete the CRM connection for <strong className="break-all">{mailbox.email}</strong>? This removes its saved credentials and stops sending and syncing. Existing email history and the mailbox at your email provider are kept.</p>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={pending}>{pending ? "Deleting..." : "Delete connection"}</Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {state?.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-primary">{state.success}</p> : null}
    </div>
  );
}
