import type { WorkspaceViewer } from "../auth.ts";
import { hasAiProvider } from "../ai/provider-credentials.ts";
import { defaultViewerMailbox } from "../mailbox-utils.ts";
import { emailPageRequestSchema, type EmailPageRequest, type EmailPageInfo } from "../email-pagination.ts";
import type { EmailInboxBackendData, InboxEmailItem } from "../email-inbox.ts";
import { buildShopifyFormInboxItems, buildMetaLeadInboxItems, type ShopifyInquiryRow, type MetaInquiryRow } from "../lead-inquiries.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { mailboxHasImap, mailboxHasSmtp, type WorkspaceMailboxRecord } from "./mailboxes.ts";
import { getEmailAutomationSettings } from "./email-state.ts";
import { mailboxSyncKey, savedProviderFolders, presentMailboxMessage } from "./mailbox-sync.ts";
import { listInboxCompanies } from "./inbox-companies.ts";
import { listFollowupActions } from "./email-followup-status";
import { resolveEmailContentIds } from "../email-content.ts";
import { getInitials } from "../crm-model.ts";
import { memberAvatarUrl } from "../member-avatar-url.ts";

export async function emailPageRevision(viewer: WorkspaceViewer, mailbox: WorkspaceMailboxRecord, keys: string[]) {
  const { data, error } = await createSupabaseAdmin().rpc("crm_email_page_revision", { p_actor: viewer.id, p_mailbox: mailbox.id, p_keys: keys, p_personal: mailbox.type === "personal" });
  if (error) throw new Error(`Unable to check saved emails: ${error.message}`);
  return String(data);
}

export async function getEmailInboxPageData({ viewer, mailboxes, mailboxId, request: input, thread }: {
  viewer: WorkspaceViewer; mailboxes: WorkspaceMailboxRecord[]; mailboxId?: string; request?: Partial<EmailPageRequest>; thread?: string;
}): Promise<EmailInboxBackendData> {
  const request = emailPageRequestSchema.parse(input ?? {});
  const sender = defaultViewerMailbox(mailboxes);
  const mailbox = mailboxId ? mailboxes.find(value => value.id === mailboxId) : sender;
  if (mailboxId && !mailbox) throw new Error("Mailbox unavailable.");
  const [folders, actions, automation] = await Promise.all([
    mailbox ? savedProviderFolders(mailbox) : Promise.resolve([]),
    mailbox ? listFollowupActions(viewer, mailbox.id, { mailboxes }) : Promise.resolve([]),
    getEmailAutomationSettings(viewer.id, 0),
  ]);
  const keys = mailbox ? [{ key: mailboxSyncKey(mailbox), path: "INBOX", kind: "inbox" }, ...folders.filter(folder => folder.kind !== "inbox").map(folder => ({ key: mailboxSyncKey(mailbox, folder.path), path: folder.path, kind: folder.kind }))] : [];
  const { data, error } = mailbox ? await createSupabaseAdmin().rpc("crm_email_list_page_snapshot", {
    p_actor: viewer.id, p_mailbox: mailbox.id, p_folders: keys, p_personal: mailbox.type === "personal",
    p_owner: mailbox.type !== "personal" && viewer.role === "bd_manager" ? viewer.id : null,
    p_folder: request.folder, p_query: request.query, p_source: request.source, p_tag: request.tag,
    p_followup: request.followup, p_actions: actions, p_page: request.page, p_thread: thread ?? null,
    }) : { data: { emails: [], revision: "empty", contextComplete: true, total: 0, page: 1, pageSize: 30, folderCounts: {}, followupCounts: { all: 0, ai: 0, manual: 0, completed: 0, nurture: 0 } }, error: null };
  if (error) throw new Error(`Unable to load saved emails: ${error.message}`);
  const result = data as { emails: Array<InboxEmailItem & { leadRow?: ShopifyInquiryRow | MetaInquiryRow }>; revision: string; contextComplete?: boolean; total: number; page: number; pageSize: number; folderCounts: Record<string, number>; followupCounts: EmailPageInfo["followupCounts"]; syncedAt?: string; inboxError?: string };
  let emails = result.emails.map(item => {
    const { leadRow, ...message } = item;
    if (leadRow) return { ...message, ...(item.id.startsWith("shopify-") ? buildShopifyFormInboxItems([leadRow as ShopifyInquiryRow])[0] : buildMetaLeadInboxItems([leadRow as MetaInquiryRow])[0]), company: message.company, companyId: message.companyId };
    if (message.mailboxKey && message.source === "mailbox") return presentMailboxMessage(message, message.mailboxKey);
    // Sent attachments use authorized download endpoints, never raw payload data.
    if (message.id.startsWith("sent-")) {
      message.attachments = message.attachments?.map((attachment, index) => ({ filename: attachment.filename, contentType: attachment.contentType, size: attachment.size, cid: attachment.cid, url: `/api/email/attachments/${message.id.slice(5)}/${index}` }));
      if (message.html) message.html = resolveEmailContentIds(message.html, message.attachments ?? []);
    }
    return message;
  });
  const assigned = mailbox?.type !== "personal" && viewer.role === "bd_manager" ? new Map(emails.flatMap(email => email.companyId ? [[email.contact.toLowerCase(), email.companyId] as const] : [])) : null;
  // Older database versions retain the bounded compatibility read. The current
  // RPC already returns visible company/owner fields in the same request.
  const { companies } = !result.contextComplete && emails.length ? await listInboxCompanies(emails, assigned) : { companies: [] };
  const byEmail = new Map(companies.map(company => [company.email.toLowerCase(), company]));
  emails = emails.map(email => { const company = byEmail.get(email.contact.toLowerCase()); return { ...email, company: company?.name || email.company,
    companyId: company?.id ?? email.companyId, ownerId: company?.ownerId ?? email.ownerId, ownerName: company?.ownerName ?? email.ownerName ?? "Unassigned", ownerInitials: company?.ownerInitials ?? (email.ownerId ? getInitials(email.ownerName ?? "BD Sales Manager") : "—"), ownerAvatarUrl: result.contextComplete && email.ownerId ? memberAvatarUrl(email.ownerId) : company?.ownerAvatarUrl,
    customerProfile: company ? { companyName: company.name, contactName: email.contactName || company.contact, contactRole: company.contactRole,
      website: company.website, country: company.country, city: company.city, segment: company.segment, summary: company.summary,
      interests: company.tags, fitScore: company.fitScore, currency: company.currency } : email.customerProfile,
    customerContextStatus: company || email.customerProfile ? "ready" as const : "pending" as const }; });
  return {
    mode: "live", mailboxConfigured: mailboxHasImap(mailbox) && mailboxHasSmtp(sender), sendConfigured: mailboxHasSmtp(sender), inboxConfigured: mailboxHasImap(mailbox),
    inboxError: result.inboxError ?? null, lastMailboxSync: result.syncedAt ?? null, aiConfigured: hasAiProvider(process.env), defaultMailboxEmail: sender?.email ?? null,
    mailboxes: mailboxes.map(mailbox => ({ id: mailbox.id, email: mailbox.email, type: mailbox.type, sendConfigured: mailboxHasSmtp(mailbox), inboxConfigured: mailboxHasImap(mailbox) })),
    selectedMailboxId: mailbox?.id ?? null, defaultSenderId: sender?.id ?? null, assignedCustomersOnly: mailbox?.type !== "personal" && viewer.role === "bd_manager",
    emails, providerFolders: folders, automation: { ...automation, queueCount: result.total },
    pagination: { request: { ...request, page: result.page }, total: result.total, pageSize: result.pageSize, folderCounts: result.folderCounts, followupCounts: result.followupCounts, revision: result.revision },
  };
}
