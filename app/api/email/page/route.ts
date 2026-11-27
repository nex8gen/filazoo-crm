import { after } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth";
import { emailPageRequestSchema } from "@/lib/email-pagination";
import { getEmailInboxPageData, emailPageRevision } from "@/lib/data/email-pagination";
import { getViewerMailboxes, mailboxHasImap } from "@/lib/data/mailboxes";
import { mailboxSyncKey, savedProviderFolders } from "@/lib/data/mailbox-sync";
import { enqueueMailboxSync, runMailSyncWorker, withMailSyncWorkerLease } from "@/lib/data/mail-sync-worker";
import { withWorkspaceViewer } from "@/lib/workspace-context";

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return withWorkspaceViewer(viewer, async () => {
    const params = new URL(request.url).searchParams;
    const mailboxes = await getViewerMailboxes(viewer.id);
    const mailbox = mailboxes.find(mailbox => mailbox.id === params.get("mailboxId"));
    if (!mailbox) return Response.json({ error: "Mailbox unavailable." }, { status: 404 });
    const input = emailPageRequestSchema.parse({ page: params.get("page") ?? 1, folder: params.get("folder") ?? "inbox", query: params.get("q") ?? "", source: params.get("source") ?? "all", tag: params.get("tag") ?? "", followup: params.get("followup") ?? "all" });
    const refresh = params.get("refresh");
    if (refresh && mailboxHasImap(mailbox)) after(() => withWorkspaceViewer(viewer, async () => {
      await enqueueMailboxSync(mailbox, { refresh: true, history: refresh === "history", ...(input.folder.startsWith("provider:") ? { folder: input.folder.slice(9) } : {}) });
      await withMailSyncWorkerLease(() => runMailSyncWorker({ seed: false, budgetMs: 75_000, maxJobs: 8 }));
    }));
    try {
      if (params.has("revision")) {
        const folders = await savedProviderFolders(mailbox);
        const revision = await emailPageRevision(viewer, mailbox, [mailboxSyncKey(mailbox), ...folders.filter(folder => folder.kind !== "inbox").map(folder => mailboxSyncKey(mailbox, folder.path))]);
        if (revision === params.get("revision")) return Response.json({ unchanged: true, revision }, { headers: { "Cache-Control": "private, no-store" } });
      }
      return Response.json(await getEmailInboxPageData({ viewer, mailboxes, mailboxId: mailbox.id, request: input }), { headers: { "Cache-Control": "private, no-store" } });
    } catch { return Response.json({ error: "Unable to load saved emails. Please retry." }, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
  });
}
