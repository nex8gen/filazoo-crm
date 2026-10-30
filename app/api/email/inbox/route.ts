import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";
import { after } from "next/server";
import { getUserMailbox, getViewerMailboxes, mailboxHasImap } from "@/lib/data/mailboxes";
import { loadSyncedMailbox } from "@/lib/data/mailbox-sync";
import { getCompanyDetails } from "@/lib/data/crm";
import { getCompanyEmailBackendData } from "@/lib/data/company-emails";

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
  // Return saved mail immediately. Provider login and importing older mail
  // continue after the response, with a shared lease across server instances.
  if (params.get("refresh") !== "false") after(async () => {
    const ownerMailbox = company?.company.ownerId ? await getUserMailbox(company.company.ownerId) : null;
    const availableMailboxes = [...new Map([...mailboxes, ...(ownerMailbox ? [ownerMailbox] : [])].map((mailbox) => [mailbox.id, mailbox])).values()];
    const refreshMailboxes = availableMailboxes.filter((item) => (company || item.id === data.selectedMailboxId) && mailboxHasImap(item));
    await Promise.all(refreshMailboxes.map(async (mailbox) => {
      try {
        await loadSyncedMailbox(mailbox, { history, includeContent: false });
        const { processEmailAutoReplies } = await import("@/lib/data/email-auto-reply-worker");
        await processEmailAutoReplies(mailbox.id);
      } catch (error) {
        console.warn("Mailbox background refresh failed:", error instanceof Error ? error.message : "Unknown error");
      }
    }));
  });

  return Response.json(data, {
    headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${(authorizedAt - start).toFixed(1)},inbox;dur=${(performance.now() - authorizedAt).toFixed(1)}` },
    status: 200,
  });
}
