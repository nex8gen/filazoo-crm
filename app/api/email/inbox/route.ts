import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";
import { getUserMailbox, getViewerMailboxes, mailboxHasImap } from "@/lib/data/mailboxes";
import { enqueueMailboxSync, readMailboxSyncHealth } from "@/lib/data/mail-sync-worker";
import { getCompanyDetails } from "@/lib/data/crm";
import { getCompanyEmailBackendData } from "@/lib/data/company-emails";
import { after } from "next/server";

export const maxDuration = 240;

export async function GET(request: Request) {
  const start = performance.now();
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const authorizedAt = performance.now();
  const params = new URL(request.url).searchParams;
  const history = params.get("scope") === "history";
  const mailboxId = params.get("mailboxId") ?? undefined;
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
  }, { viewer, mailboxes }) : await getEmailInboxBackendData({ syncMailbox: false, mailboxId, context: { viewer, mailboxes } });
  // Persist intent before returning. No provider work depends on this request surviving.
  const syncHealth: Record<string, Awaited<ReturnType<typeof readMailboxSyncHealth>>> = {};
  let syncQueueError: string | null = null;
  {
    const refreshRequested = params.get("refresh") !== "false";
    const ownerMailbox = company?.company.ownerId ? await getUserMailbox(company.company.ownerId) : null;
    const availableMailboxes = [...new Map([...mailboxes, ...(ownerMailbox ? [ownerMailbox] : [])].map((mailbox) => [mailbox.id, mailbox])).values()];
    const refreshMailboxes = availableMailboxes.filter((item) => (company || item.id === data.selectedMailboxId) && mailboxHasImap(item));
    await Promise.all(refreshMailboxes.map(async (mailbox) => {
      try {
        if (refreshRequested) await enqueueMailboxSync(mailbox, { history, folder: params.get("providerFolder") || undefined, refresh: true });
        const folder = params.get("providerFolder") || "INBOX";
        syncHealth[mailbox.id] = await readMailboxSyncHealth(mailbox, folder === "INBOX" ? data.lastMailboxSync || null : null, folder);
      } catch (error) {
        console.warn("Mailbox queue unavailable:", error instanceof Error ? error.message : "Unknown error");
        syncQueueError = refreshRequested ? "Mailbox refresh could not be queued. Saved messages are still available." : "Unable to check mailbox updates. Saved messages are still available.";
      }
    }));
    if (refreshRequested && viewer.role !== "viewer" && refreshMailboxes.length) after(async () => {
      try {
        const { processAutomaticConversationTags } = await import("@/lib/data/conversation-tagging");
        await processAutomaticConversationTags({ mailboxIds: refreshMailboxes.map(mailbox => mailbox.id), maxConversations: 2 });
      } catch { console.error("Automatic conversation tagging will retry on the next mailbox refresh."); }
    });
  }

  return Response.json({ ...data, syncHealth, syncQueueError }, {
    headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${(authorizedAt - start).toFixed(1)},inbox;dur=${(performance.now() - authorizedAt).toFixed(1)}` },
    status: 200,
  });
}
