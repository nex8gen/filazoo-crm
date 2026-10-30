"use client";

import { startTransition, useActionState, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
          <div className="flex items-center gap-2">{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-muted-foreground" /> : null}<Switch checked={mailbox.isActive} disabled={pending} aria-label={`Sending and syncing: ${mailbox.email}`} onCheckedChange={enabled => { const data = new FormData(); data.set("mailboxId", mailbox.id); data.set("operation", enabled ? "resume" : "stop"); startTransition(() => action(data)); }} /></div>
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
