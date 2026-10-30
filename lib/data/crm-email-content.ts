import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { WorkspaceViewer } from "../auth.ts";
import { canViewEmail } from "../email-access.ts";
import { getAssignedEmailContacts } from "./email-access.ts";
import { normalizeMailboxRow } from "../mailbox-utils.ts";
import { normalizeMessageId } from "../email-threading.ts";
import { mailboxSyncKey, savedProviderFolders, loadMailboxMessageContent } from "./mailbox-sync.ts";
import { resolveEmailContentIds, plainEmailContentHtml } from "../email-content.ts";
import { escapeEmailHtml } from "../email-markup.ts";
import type { InboxEmailItem } from "../email-inbox.ts";

/** A shared CRM copy grants access only to that exact received Message-ID and sender.
 * No caller-supplied mailbox, UID, owner, or contact can select personal mail. */
export async function readCrmReceivedEmail(viewer: WorkspaceViewer, id: string, options: { includeContent?: boolean } = {}) {
  const db = createSupabaseAdmin();
  const { data: row } = await db.from("emails").select("id,message_id,owner_id,subject,body,thread_id,created_at,contacts!inner(email)")
    .eq("id", id).eq("direction", "received").maybeSingle().throwOnError();
  const contact = (Array.isArray(row?.contacts) ? row.contacts[0] : row?.contacts)?.email as string | undefined;
  if (!row || !contact || !canViewEmail(viewer, contact, await getAssignedEmailContacts(viewer))) return null;
  const fallback: InboxEmailItem = { id: row.id, crmEmailId: row.id, source: "crm", direction: "inbound", status: "Received", subject: row.subject || "(No subject)", contact,
    company: "Unknown company", body: row.body || "", preview: (row.body || "").slice(0, 160), html: null, bodyLoaded: true,
    messageId: row.message_id, threadId: row.thread_id, timestamp: row.created_at, attachments: [] };
  if (!row.message_id) return { email: fallback, source: null };
  let query = db.from("workspace_mailboxes").select("*").eq("is_active", true);
  query = row.owner_id ? query.or(`type.eq.workspace,user_id.eq.${row.owner_id}`) : query.eq("type", "workspace");
  const { data: accounts } = await query.throwOnError();
  for (const account of (accounts || []).sort((a, b) => Number(b.type === "personal") - Number(a.type === "personal"))) {
    const mailbox = normalizeMailboxRow(account);
    if (!mailbox?.imapHost || !mailbox.imapUsername || !mailbox.imapPassword) continue;
    const folders = ["INBOX", ...(await savedProviderFolders(mailbox)).filter((folder) => folder.kind !== "inbox").map((folder) => folder.path)];
    const byKey = new Map(folders.map((folder) => [mailboxSyncKey(mailbox, folder), folder]));
    const { data: cached } = await db.from("mailbox_message_content").select(options.includeContent === false
      ? "mailbox_key,uid,uid_validity,contact:content->>contact,direction:content->>direction,message_id:content->>messageId,attachments:content->attachments"
      : "mailbox_key,uid,uid_validity,content")
      .in("mailbox_key", [...byKey.keys()]).eq("content->>messageId", row.message_id).limit(5).throwOnError();
    // Supabase's dynamic projection has a different shape for attachment-only reads.
    type Location = { mailbox_key: string; uid: number; uid_validity: number; content?: InboxEmailItem; contact?: string; direction?: string; message_id?: string; attachments?: InboxEmailItem["attachments"] };
    let location = ((cached || []) as unknown as Location[]).find((item) => (item.content?.contact || item.contact)?.trim().toLowerCase() === contact.trim().toLowerCase());
    if (!location) {
      const { data: headers } = await db.from("mailbox_sync_state").select("mailbox_key,uid_validity,messages")
        .in("mailbox_key", [...byKey.keys()]).contains("messages", [{ messageId: row.message_id }]).throwOnError();
      for (const header of headers || []) {
        const message = (header.messages as InboxEmailItem[]).find((item) => !item.providerRemoved && item.messageId === row.message_id && item.contact.trim().toLowerCase() === contact.trim().toLowerCase());
        if (message?.uid) { location = { mailbox_key: header.mailbox_key, uid: message.uid, uid_validity: header.uid_validity, content: message }; break; }
      }
    }
    if (!location) continue;
    const folder = byKey.get(location.mailbox_key)!;
    const original = options.includeContent === false
      ? location.content || { ...fallback, contact: location.contact!, direction: location.direction as "inbound" | "outbound", messageId: location.message_id, attachments: location.attachments }
      : await loadMailboxMessageContent(mailbox, location.uid, location.uid_validity, folder);
    if (original.direction !== "inbound" || normalizeMessageId(original.messageId) !== normalizeMessageId(row.message_id) || original.contact.trim().toLowerCase() !== contact.trim().toLowerCase()) continue;
    // Retain the CRM identity/access context. Never expose private mailbox download URLs.
    let html = original.html;
    const attachments = original.attachments?.map((attachment) => {
      const url = attachment.partId ? `/api/email/crm-attachment?id=${encodeURIComponent(row.id)}&part=${encodeURIComponent(attachment.partId)}` : undefined;
      if (html && attachment.url && url) html = html.replaceAll(escapeEmailHtml(attachment.url), escapeEmailHtml(url)).replaceAll(attachment.url, url);
      return { ...attachment, url };
    }) || [];
    html = html ? resolveEmailContentIds(html, attachments) : plainEmailContentHtml(original.body, attachments);
    return { email: { ...fallback, from: original.from, to: original.to, cc: original.cc, replyTo: original.replyTo, body: original.body, preview: original.preview, html, attachments, inReplyTo: original.inReplyTo, references: original.references },
      source: { mailbox, folder, uid: location.uid, validity: location.uid_validity } };
  }
  return { email: fallback, source: null };
}
