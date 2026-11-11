import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { normalizeMailboxRow } from "../mailbox-utils.ts";
import { normalizeMessageId, threadKeyForEmail } from "../email-threading.ts";

function emailId(key: string) {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Cache projection only. Receiving mail never depends on who authored a flow. */
export async function syncFlowMailboxMessages(options: { deadline?: number; mailboxId?: string; contactId?: string } = {}) {
  const deadline = options.deadline ?? Date.now() + 20_000;
  const expired = () => Date.now() >= deadline - 500;
  const admin = createSupabaseAdmin();
  let projected = 0;
  const { data: selectedContact } = options.contactId ? await admin.from("contacts").select("id,email").eq("id", options.contactId).maybeSingle().throwOnError() : { data: null };
  if (options.contactId && !selectedContact) throw new Error("The workflow contact no longer exists.");
  const contactsByEmail = new Map<string, string | null>();
  async function loadContacts(addresses: string[]) {
    const missing = [...new Set(addresses.map(address => address.toLowerCase()))].filter(address => !contactsByEmail.has(address));
    for (let index = 0; index < missing.length; index += 100) {
      if (expired()) return;
      const batch = missing.slice(index, index + 100);
      const { data } = await admin.from("contacts").select("id,email").in("email", batch).throwOnError();
      for (const address of batch) contactsByEmail.set(address, null);
      const ambiguous = new Set<string>();
      for (const contact of data ?? []) {
        const address = contact.email.toLowerCase();
        if (contactsByEmail.get(address)) ambiguous.add(address);
        else contactsByEmail.set(address, contact.id);
      }
      for (const address of ambiguous) contactsByEmail.set(address, null);
    }
  }
  async function existing(ids: string[], mailboxId?: string) {
    const found = new Map<string, { id: string; body_loaded?: boolean }>();
    for (let index = 0; index < ids.length; index += 100) {
      if (expired()) break;
      let query = admin.from("emails").select("id,message_id,body_loaded,mailbox_id").in("message_id", ids.slice(index, index + 100));
      if (mailboxId) query = query.or(`mailbox_id.is.null,mailbox_id.eq.${mailboxId}`);
      const { data } = await query.throwOnError();
      for (const row of data ?? []) found.set(normalizeMessageId(row.message_id)!, row);
    }
    return found;
  }
  const mailboxQuery = admin.from("workspace_mailboxes").select("*").eq("is_active", true);
  const { data: mailboxes } = await mailboxQuery.throwOnError();
  const ownAddresses = new Set((mailboxes ?? []).map(row => String(row.email).toLowerCase()));
  const { loadSyncedMailbox, mailboxSyncKey } = await import("./mailbox-sync.ts");
  const ordered = (mailboxes ?? []).filter(row => !options.mailboxId || row.id === options.mailboxId).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const rotation = ordered.length ? Math.floor(Date.now() / 60_000) % ordered.length : 0;
  ordered.push(...ordered.splice(0, rotation));
  for (const row of ordered) {
    if (expired()) break;
    const mailbox = normalizeMailboxRow(row);
    if (!mailbox) continue;
    const snapshot = await loadSyncedMailbox(mailbox, { sync: false, includeContent: false });
    if (snapshot.error) throw new Error(`Mailbox cache is not current: ${snapshot.error}`);
    const candidates = snapshot.messages.filter(message => message.messageId && message.direction !== "outbound"
      && message.status !== "Sent" && !message.providerRemoved && Number.isFinite(Date.parse(message.timestamp))
      && (!selectedContact || message.contact.toLowerCase() === selectedContact.email.toLowerCase())
      && !ownAddresses.has(message.contact.toLowerCase())).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    await loadContacts(candidates.map(message => message.contact));
    const matched = candidates.filter(message => contactsByEmail.get(message.contact.toLowerCase()));
    const found = await existing([...new Set(matched.flatMap(message => [message.messageId!, normalizeMessageId(message.messageId)!]))], mailbox.id);
    for (let offset = 0; offset < matched.length; offset += 50) {
      if (expired()) break;
      const pending = matched.slice(offset, offset + 50).filter(message => found.get(normalizeMessageId(message.messageId)!)?.body_loaded !== true);
      if (!pending.length) continue;
      const { data: bodies } = await admin.from("mailbox_message_content").select("uid,content")
        .eq("mailbox_key", mailboxSyncKey(mailbox)).eq("uid_validity", pending[0].uidValidity ?? 0)
        .in("uid", pending.flatMap(message => message.uid ? [message.uid] : [])).throwOnError();
      const content = new Map((bodies ?? []).map(body => [Number(body.uid), body.content]));
      const referenceIds = [...new Set(pending.flatMap(message => [...(message.references ?? []), message.inReplyTo]).filter((id): id is string => Boolean(id)).flatMap(id => [id, normalizeMessageId(id)!]))];
      const { data: parents } = referenceIds.length ? await admin.from("emails").select("message_id,thread_id")
        .in("message_id", referenceIds).order("created_at", { ascending: false }).throwOnError() : { data: [] };
      const threads = new Map<string, string>();
      for (const parent of parents ?? []) if (parent.thread_id && !threads.has(normalizeMessageId(parent.message_id)!)) threads.set(normalizeMessageId(parent.message_id)!, parent.thread_id);
      const writes = [];
      for (const message of pending) {
        const id = normalizeMessageId(message.messageId)!, old = found.get(id), full = content.get(message.uid ?? -1);
        const references = [...(message.references ?? []), message.inReplyTo].filter(Boolean) as string[];
        const parentThread = [...references].reverse().map(reference => threads.get(normalizeMessageId(reference)!)).find(Boolean);
        const rowId = old?.id ?? emailId(`${mailbox.id}:${id}`);
        writes.push({ id: rowId, contact_id: contactsByEmail.get(message.contact.toLowerCase())!, direction: "received",
          subject: message.subject, body: full?.body ?? (message.bodyLoaded ? message.body : null), body_loaded: Boolean(full || message.bodyLoaded),
          message_id: id, thread_id: parentThread || threadKeyForEmail(message), status: "received", created_at: message.timestamp,
          owner_id: mailbox.type === "personal" ? mailbox.userId : null, mailbox_id: mailbox.id, mailbox_uid: message.uid ?? null,
          mailbox_uid_validity: message.uidValidity ?? null, automatic_response: message.automaticResponse === true });
        found.set(id, { id: rowId, body_loaded: Boolean(full || message.bodyLoaded) });
        threads.set(id, parentThread || threadKeyForEmail(message));
      }
      if (writes.length) {
        await admin.from("emails").upsert(writes, { onConflict: "id", ignoreDuplicates: false }).throwOnError();
        projected += writes.length;
      }
    }
  }
  if (!expired()) {
    let sentQuery = admin.from("mailbox_sent_messages").select("*").eq("status", "sent");
    if (selectedContact) sentQuery = sentQuery.eq("to_email", selectedContact.email.toLowerCase());
    const { data } = await sentQuery.order("sent_at", { ascending: false }).limit(1000).throwOnError();
    const sent = (data ?? []).filter(message => message.message_id && message.status === "sent");
    await loadContacts(sent.map(message => message.to_email));
    const found = await existing(sent.flatMap(message => [message.message_id, normalizeMessageId(message.message_id)!]));
    for (let offset = 0; offset < sent.length && !expired(); offset += 100) {
      const writes = sent.slice(offset, offset + 100).flatMap(message => {
        const contactId = contactsByEmail.get(message.to_email.toLowerCase()), id = normalizeMessageId(message.message_id)!;
        return !contactId || found.has(id) ? [] : [{ id: emailId(`${message.mailbox_id}:${id}`), contact_id: contactId, direction: "sent", subject: message.subject,
          body: message.body, body_loaded: true, message_id: id, thread_id: message.thread_key || `message:${id}`, status: "sent", sent_at: message.sent_at,
          created_at: message.sent_at, owner_id: message.user_id, mailbox_id: message.mailbox_id }];
      });
      if (writes.length) await admin.from("emails").upsert(writes, { onConflict: "id", ignoreDuplicates: true }).throwOnError();
    }
  }
  return { projected, complete: !expired() };
}
