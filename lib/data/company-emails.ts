import { requireWorkspaceMember, type WorkspaceViewer } from "../auth.ts";
import { companyEmailContact, filterCompanyEmails, scopeCompanyEmailContent, type CompanyEmailScope } from "../company-email.ts";
import { createEmailInboxReadContext, getEmailInboxBackendData, type EmailInboxBackendData } from "../email-inbox.ts";
import { normalizeMessageId } from "../email-threading.ts";
import { getViewerMailboxes, type WorkspaceMailboxRecord } from "./mailboxes.ts";
import { getCompanyEmailScope, getCompanyEmailScopes, listCompanyEmailMailboxes } from "./company-email-access.ts";
import { applyConversationCustomerTags } from "../customer-tags.ts";

/** Company history spans authorized accounts, independently of the default sender. */
export async function getCompanyEmailBackendData(company: CompanyEmailScope, context?: { viewer: WorkspaceViewer; mailboxes: WorkspaceMailboxRecord[] }): Promise<EmailInboxBackendData> {
  return (await getCompaniesEmailBackendData([company.id], context)).get(company.id)!;
}

/** Share the profile Email tab's authorization, matching and deduplication with AI.
 * Read each mailbox once for a customer page; never grant another staff sender. */
export async function getCompaniesEmailBackendData(companyIds: string[], context?: { viewer: WorkspaceViewer; mailboxes: WorkspaceMailboxRecord[] }, options: { history?: boolean } = {}): Promise<Map<string, EmailInboxBackendData>> {
  const viewer = context?.viewer ?? await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const companies = companyIds.length > 1 ? await getCompanyEmailScopes(viewer, companyIds) : await Promise.all([...new Set(companyIds)].map(async id => {
    const company = await getCompanyEmailScope(viewer, id);
    if (!company) throw new Error("Company unavailable.");
    return company;
  }));
  if (!companies.length) return new Map();
  const viewerMailboxes = context?.mailboxes ?? await getViewerMailboxes(viewer.id);
  const mailboxes = [...new Map([...viewerMailboxes, ...await listCompanyEmailMailboxes()].map((mailbox) => [mailbox.id, mailbox])).values()];
  const staffAddresses = new Set(mailboxes.flatMap(mailbox => [mailbox.email, mailbox.imapUsername]).flatMap(address => address?.trim() ? [address.trim().toLowerCase()] : []));
  const authorized = createEmailInboxReadContext(viewer, mailboxes, companies.flatMap(company => company.emails), viewerMailboxes);
  const snapshots = await Promise.all((mailboxes.length ? mailboxes.map((mailbox) => mailbox.id) : [undefined]).map((mailboxId) =>
    getEmailInboxBackendData({ syncMailbox: false, mailboxId, context: authorized, ...(options.history ? { history: true } : {}) }),
  ));
  const states = await authorized.states!;
  return new Map(companies.map(company => {
    const seen = new Set<string>();
    const addresses = new Set(company.emails.map(address => address.trim().toLowerCase()));
    const emails = snapshots.flatMap((snapshot) => filterCompanyEmails(snapshot.emails, company)
      .filter(email => email.providerKind !== "drafts" && email.status !== "Provider draft" && !email.providerRemoved)
      .map((email) => ({
        ...scopeCompanyEmailContent(email, company.id),
        contact: companyEmailContact(email, addresses)!,
        direction: email.from && staffAddresses.has(email.from.trim().toLowerCase()) ? "outbound" as const : email.direction,
        mailboxId: email.mailboxId ?? (email.source === "mailbox" ? snapshot.selectedMailboxId : null),
      }))).sort((a, b) => Number(Boolean(b.uid && b.mailboxKey)) - Number(Boolean(a.uid && a.mailboxKey))).filter((email) => {
      // Shared CRM/Shopify records appear in every workspace snapshot.
      const key = `${email.direction}:${normalizeMessageId(email.messageId) || email.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return [company.id, {
      ...snapshots[0],
      // Reading customer correspondence never grants another staff member's sender.
      mailboxes: snapshots[0].mailboxes.filter(mailbox => viewerMailboxes.some(own => own.id === mailbox.id)),
      defaultSenderId: viewerMailboxes.some(mailbox => mailbox.id === snapshots[0].defaultSenderId) ? snapshots[0].defaultSenderId : null,
      selectedMailboxId: null,
      inboxConfigured: snapshots.some((snapshot) => snapshot.inboxConfigured),
      mailboxConfigured: snapshots.some((snapshot) => snapshot.inboxConfigured) && snapshots[0].sendConfigured,
      inboxError: snapshots.flatMap((snapshot) => snapshot.inboxError ? [snapshot.inboxError] : []).join("; ") || null,
      mailboxReadFailed: snapshots.some((snapshot) => snapshot.mailboxReadFailed),
      mailboxSnapshotPartial: snapshots.some((snapshot) => snapshot.mailboxSnapshotPartial),
      mailboxHistoryPartial: snapshots.some((snapshot) => snapshot.mailboxHistoryPartial),
      emails: applyConversationCustomerTags(emails, states),
    }];
  }));
}
