import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";
import { getViewerMailboxes, mailboxHasImap } from "@/lib/data/mailboxes";
import { listCompanyEmailMailboxes } from "@/lib/data/company-email-access";
import { enqueueMailboxSync, readMailboxSyncHealth, runMailSyncWorker, withMailSyncWorkerLease } from "@/lib/data/mail-sync-worker";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { getCompanyDetails } from "@/lib/data/crm";
import { getCompanyEmailBackendData } from "@/lib/data/company-emails";
import { after } from "next/server";
import { validProviderFolder } from "@/lib/email-provider";

export const maxDuration = 240;

export async function GET(request: Request) {
  const start = performance.now();
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const authorizedAt = performance.now();
  return withWorkspaceViewer(viewer, async () => {
    const params = new URL(request.url).searchParams;
    const history = params.get("scope") === "history";
    const mailboxId = params.get("mailboxId") ?? undefined;
    const providerFolder = params.get("providerFolder") || undefined;
    if (providerFolder && !validProviderFolder(providerFolder)) return Response.json({ error: "Invalid folder." }, { status: 400 });
    const mailboxes = await getViewerMailboxes(viewer.id);
    if (mailboxId !== undefined && !mailboxes.some((mailbox) => mailbox.id === mailboxId)) return Response.json({ error: "Mailbox unavailable." }, { status: 404 });
    const companyId = params.get("companyId");
    const company = companyId ? (await getCompanyDetails(companyId)).details : null;
    if (companyId && !company) return Response.json({ error: "Company not found." }, { status: 404 });
    const data = company ? await getCompanyEmailBackendData({
      id: company.company.id,
      name: company.company.name,
      ownerId: company.company.ownerId,
      emails: [company.company.email, ...company.contacts.map((contact) => contact.email)],
    }, { viewer, mailboxes }) : await getEmailInboxBackendData({ syncMailbox: false, mailboxId, context: { viewer, mailboxes }, interactive: true, providerFolder });
    // Manual refresh persists intent before returning. Automatic checks return
    // saved messages first and enqueue receiving in Next's after-response work.
    const syncHealth: Record<string, Awaited<ReturnType<typeof readMailboxSyncHealth>>> = {};
    let syncQueueError: string | null = null;
    let historyQueued = false;
    {
      const historyPartial = data.mailboxHistoryPartial ?? data.mailboxSnapshotPartial;
      const refreshRequested = params.get("refresh") !== "false" && !historyPartial;
      const backgroundRefresh = params.get("refresh") === "background";
      const availableMailboxes = company ? await listCompanyEmailMailboxes() : mailboxes;
      const refreshMailboxes = availableMailboxes.filter((item) => (company || item.id === data.selectedMailboxId) && mailboxHasImap(item));
      await Promise.all(refreshMailboxes.map(async (mailbox) => {
        try {
          if (refreshRequested && !backgroundRefresh) { await enqueueMailboxSync(mailbox, { history, folder: params.get("providerFolder") || undefined, refresh: true }); if (history) historyQueued = true; }
          const folder = params.get("providerFolder") || "INBOX";
          // Switching reads saved mail without another serial status query.
          if (!historyPartial && ((refreshRequested && !backgroundRefresh) || params.get("health") === "true")) syncHealth[mailbox.id] = await readMailboxSyncHealth(mailbox, folder === "INBOX" ? data.lastMailboxSync || null : null, folder);
        } catch (error) {
          console.warn("Mailbox queue unavailable:", error instanceof Error ? error.message : "Unknown error");
          syncQueueError = refreshRequested ? "Mailbox refresh could not be queued. Saved messages are still available." : "Unable to check mailbox updates. Saved messages are still available.";
        }
      }));
      // Local installs also receive without a separate worker process. The shared
      // lease prevents overlapping tabs and cron ticks from starting competitors.
      if (refreshRequested && refreshMailboxes.length && !syncQueueError) after(() => withWorkspaceViewer(viewer, async () => {
        try {
          if (backgroundRefresh) await Promise.all(refreshMailboxes.map(mailbox => enqueueMailboxSync(mailbox, { folder: params.get("providerFolder") || undefined, refresh: true })));
          await withMailSyncWorkerLease(() => runMailSyncWorker({ seed: false, budgetMs: 75_000, maxJobs: 8 }));
        }
        catch { console.error("Mailbox receiving will retry on the next inbox check."); }
      }));
      // The receive cron owns automatic tagging. Browsing and polling must not
      // repeatedly scan mailbox history and consume the database's IO budget.
      if (refreshRequested && !backgroundRefresh && viewer.role !== "viewer" && refreshMailboxes.length) after(() => withWorkspaceViewer(viewer, async () => {
        try {
          const { processAutomaticConversationTags } = await import("@/lib/data/conversation-tagging");
          await processAutomaticConversationTags({ mailboxIds: refreshMailboxes.map(mailbox => mailbox.id), ...(company ? { companyIds: [company.company.id] } : {}), maxConversations: 2 });
        } catch { console.error("Automatic conversation tagging will retry on the next mailbox refresh."); }
      }));
    }

    // A failed cache read is not an authoritative empty mailbox. Clients retain
    // the last successful snapshot while queued receiving work can still retry.
    if (data.mailboxReadFailed) return Response.json({
      error: "Saved email could not be loaded. Your messages are kept; the inbox will retry.",
      syncHealth,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });

    return Response.json({ ...data, syncHealth, syncQueueError, historyQueued }, {
      headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${(authorizedAt - start).toFixed(1)},inbox;dur=${(performance.now() - authorizedAt).toFixed(1)}` },
      status: 200,
    });
  });
}
