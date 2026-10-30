import { requireWorkspaceMember, type WorkspaceViewer } from "../auth.ts";
import { filterCompanyEmails, type CompanyEmailScope } from "../company-email.ts";
import { createEmailInboxReadContext, getEmailInboxBackendData, type EmailInboxBackendData } from "../email-inbox.ts";
import { normalizeMessageId } from "../email-threading.ts";
import { getUserMailbox, getViewerMailboxes, type WorkspaceMailboxRecord } from "./mailboxes.ts";

/** Company history spans authorized accounts, independently of the default sender. */
export async function getCompanyEmailBackendData(company: CompanyEmailScope, context?: { viewer: WorkspaceViewer; mailboxes: WorkspaceMailboxRecord[] }): Promise<EmailInboxBackendData> {
  const viewer = context?.viewer ?? await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const viewerMailboxes = context?.mailboxes ?? await getViewerMailboxes(viewer.id);
  const ownerMailbox = company.ownerId ? await getUserMailbox(company.ownerId) : null;
  const mailboxes = [...new Map([...viewerMailboxes, ...(ownerMailbox ? [ownerMailbox] : [])].map((mailbox) => [mailbox.id, mailbox])).values()];
  const authorized = createEmailInboxReadContext(viewer, mailboxes, company.emails);
  const snapshots = await Promise.all((mailboxes.length ? mailboxes.map((mailbox) => mailbox.id) : [undefined]).map((mailboxId) =>
    getEmailInboxBackendData({ syncMailbox: false, mailboxId, context: authorized }),
  ));
  const seen = new Set<string>();
  const emails = snapshots.flatMap((snapshot) => filterCompanyEmails(snapshot.emails, company).map((email) => ({
    ...email, mailboxId: email.mailboxId ?? (email.source === "mailbox" ? snapshot.selectedMailboxId : null),
  }))).filter((email) => {
    // Shared CRM/Shopify records appear in every workspace snapshot.
    const key = `${email.direction}:${normalizeMessageId(email.messageId) || email.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return {
    ...snapshots[0],
    selectedMailboxId: null,
    inboxConfigured: snapshots.some((snapshot) => snapshot.inboxConfigured),
    mailboxConfigured: snapshots.some((snapshot) => snapshot.inboxConfigured) && snapshots[0].sendConfigured,
    inboxError: snapshots.flatMap((snapshot) => snapshot.inboxError ? [snapshot.inboxError] : []).join("; ") || null,
    emails,
  };
}
