import type { WorkspaceViewer } from "../auth.ts";
import type { CompanyEmailScope } from "../company-email.ts";
import type { InboxEmailItem } from "../email-inbox.ts";
import { companyEmailContact, filterCompanyEmails, scopeCompanyEmailContent } from "../company-email.ts";
import { normalizeMailboxRows } from "../mailbox-utils.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { mailboxSyncKey, loadMailboxMessageContent, savedProviderFolders } from "./mailbox-sync.ts";

/** Recheck the saved company and assignment; client-supplied addresses never grant access. */
export async function getCompanyEmailScope(viewer: WorkspaceViewer, companyId: string): Promise<CompanyEmailScope | null> {
  const db = createSupabaseAdmin();
  if (viewer.role === "bd_manager") {
    const { data: assignment } = await db.from("pipeline").select("company_id").eq("company_id", companyId).eq("owner_id", viewer.id).maybeSingle().throwOnError();
    if (!assignment) return null;
  }
  const { data: company } = await db.from("companies").select("id,name").eq("id", companyId).maybeSingle().throwOnError();
  if (!company) return null;
  const emails: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data } = await db.from("contacts").select("email").eq("company_id", companyId).order("id").range(offset, offset + 499).throwOnError();
    emails.push(...(data ?? []).map(row => row.email));
    if ((data?.length ?? 0) < 500) break;
  }
  const { data: staffMailboxes } = await db.from("workspace_mailboxes").select("email,imap_username").throwOnError();
  const staffAddresses = new Set((staffMailboxes ?? []).flatMap(mailbox => [mailbox.email, mailbox.imap_username])
    .flatMap(address => address?.trim() ? [address.trim().toLowerCase()] : []));
  return { ...company, emails: emails.filter(address => !staffAddresses.has(address.trim().toLowerCase())) };
}

/** Server-only source inventory. These accounts are never offered as sender choices. */
export async function listCompanyEmailMailboxes() {
  const { data } = await createSupabaseAdmin().from("workspace_mailboxes").select("*").order("created_at", { ascending: false }).throwOnError();
  return normalizeMailboxRows(data);
}

/** Authorize an exact saved UID before downloading any personal message content. */
export async function readCompanyMailboxEmail(viewer: WorkspaceViewer, companyId: string, source: { key: string; uid: number; validity: number; folder: string }) {
  const company = await getCompanyEmailScope(viewer, companyId);
  if (!company) return null;
  const mailboxes = await listCompanyEmailMailboxes();
  const mailbox = mailboxes.find(item => mailboxSyncKey(item, source.folder) === source.key);
  if (!mailbox) return null;
  if (source.folder !== "INBOX" && (await savedProviderFolders(mailbox)).some(folder => folder.path === source.folder && folder.kind === "drafts")) return null;
  const { data } = await createSupabaseAdmin().from("mailbox_sync_state").select("messages,uid_validity")
    .eq("mailbox_key", source.key).eq("uid_validity", source.validity).maybeSingle().throwOnError();
  const saved = (data?.messages as InboxEmailItem[] | undefined)?.find(message => message.uid === source.uid && !message.providerRemoved);
  if (!saved || !filterCompanyEmails([saved], company).length || saved.providerKind === "drafts") return null;
  const email = await loadMailboxMessageContent(mailbox, source.uid, source.validity, source.folder);
  if (!filterCompanyEmails([email], company).length || email.messageId !== saved.messageId) return null;
  const contact = companyEmailContact(email, new Set(company.emails.map(address => address.trim().toLowerCase())));
  const fromStaff = email.from && mailboxes.some(item => [item.email, item.imapUsername].some(address => address?.trim().toLowerCase() === email.from!.trim().toLowerCase()));
  return { mailbox, email: scopeCompanyEmailContent({ ...email, contact: contact!, direction: fromStaff ? "outbound" : email.direction }, companyId) };
}
