import { after } from "next/server";
import type { WorkspaceViewer } from "../auth.ts";
import { withWorkspaceViewer } from "../workspace-context.ts";
import { getViewerMailbox, mailboxHasImap } from "./mailboxes.ts";
import { enqueueMailboxSync, runMailSyncWorker, withMailSyncWorkerLease } from "./mail-sync-worker.ts";

/** A successful connection starts receiving without requiring an inbox visit. */
export function scheduleConnectedMailboxImport(mailboxId: string, viewer: WorkspaceViewer) {
  after(() => withWorkspaceViewer(viewer, async () => {
    try {
      const mailbox = await getViewerMailbox(viewer.id, mailboxId);
      if (!mailbox || !mailboxHasImap(mailbox)) return;
      await enqueueMailboxSync(mailbox, { history: true, refresh: true });
      await withMailSyncWorkerLease(() => runMailSyncWorker({ seed: false, budgetMs: 75_000, maxJobs: 8 }));
    } catch { console.error("Connected mailbox import will retry on the next scheduled check."); }
  }));
}
