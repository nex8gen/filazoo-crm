import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { normalizeMailboxRow } from "../mailbox-utils.ts";
import { normalizeMessageId, threadKeyForEmail } from "../email-threading.ts";

function emailId(key: string) {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// Persist mailbox messages even when nobody has the inbox page open.
export async function syncFlowMailboxMessages() {
  const admin = createSupabaseAdmin();
  // A mailbox can hold thousands of headers, mostly from non-CRM senders.
  // Resolve contacts in bounded batches, caching misses across mailboxes too.
  const contactsByEmail = new Map<string, string | null>();
  async function loadContacts(addresses: string[]) {
    const missing = [...new Set(addresses.map((address) => address.toLowerCase()))].filter((address) => !contactsByEmail.has(address));
    for (let index = 0; index < missing.length; index += 100) {
      const batch = missing.slice(index, index + 100);
      const { data } = await admin.from("contacts").select("id,email").in("email", batch).throwOnError();
      for (const address of batch) contactsByEmail.set(address, null);
      for (const contact of data ?? []) {
        const address = contact.email.toLowerCase();
        if (contactsByEmail.get(address)) throw new Error("Multiple CRM contacts have the same email address.");
        contactsByEmail.set(address, contact.id);
      }
    }
  }
  const checkedMessages = new Set<string>();
  const existingMessages = new Set<string>();
  async function loadExistingMessages(messageIds: string[]) {
    const missing = [...new Set(messageIds)].filter((id) => !checkedMessages.has(id));
    for (let index = 0; index < missing.length; index += 50) {
      const batch = missing.slice(index, index + 50);
      const { data } = await admin.from("emails").select("message_id").in("message_id", batch).throwOnError();
      for (const id of batch) checkedMessages.add(id);
      for (const email of data ?? []) existingMessages.add(email.message_id);
    }
  }
  const { data: activeFlows } = await admin.from("flows").select("user_id").eq("status", "live").throwOnError();
  const users = [...new Set((activeFlows ?? []).map((flow) => flow.user_id))];
  const { data: outbound } = users.length ? await admin.from("mailbox_sent_messages").select("*").in("user_id", users).order("sent_at", { ascending: false }).limit(1000).throwOnError() : { data: [] };
  const sent = (outbound ?? []).filter((message) => message.message_id && message.status === "sent");
  await loadContacts(sent.map((message) => message.to_email));
  await loadExistingMessages(sent.filter((message) => contactsByEmail.get(message.to_email.toLowerCase())).map((message) => message.message_id));
  for (const message of sent) {
    const contactId = contactsByEmail.get(message.to_email.toLowerCase());
    if (!contactId || existingMessages.has(message.message_id)) continue;
    await admin.from("emails").upsert({ id: emailId(message.message_id), contact_id: contactId, direction: "sent", subject: message.subject, body: message.body, message_id: message.message_id, thread_id: message.thread_key || `message:${normalizeMessageId(message.message_id)}`, status: "sent", sent_at: message.sent_at, created_at: message.sent_at, owner_id: message.user_id }, { onConflict: "id", ignoreDuplicates: true }).throwOnError();
    existingMessages.add(message.message_id);
  }
  const { data: mailboxes } = await admin.from("workspace_mailboxes").select("*").eq("is_active", true).throwOnError();
  const ownAddresses = new Set((mailboxes ?? []).map((row) => String(row.email).trim().toLowerCase()));
  const { loadSyncedMailbox, loadMailboxMessageContent } = await import("./mailbox-sync.ts");
  for (const row of mailboxes ?? []) {
    const mailbox = normalizeMailboxRow(row);
    if (!mailbox?.imapHost || !mailbox.imapUsername || !mailbox.imapPassword) continue;
    let inbound;
    try {
      const result = await loadSyncedMailbox(mailbox, { sync: false, includeContent: false });
      if (result.error) console.warn("Background mailbox sync:", result.error);
      inbound = result.messages;
    } catch (error) {
      console.warn("Background mailbox sync failed:", error instanceof Error ? error.message : "Unknown error");
      continue;
    }
    // Cache normal incoming mail even with no active automation. Only project
    // messages into the automation tables for the flows' authorized mailboxes.
    if (!users.length || (mailbox.type === "personal" && !users.includes(mailbox.userId ?? ""))) continue;
    // A copy of our own outgoing email is not a new customer inquiry.
    const candidates = inbound.filter((message) => message.messageId && !ownAddresses.has(message.contact.trim().toLowerCase()));
    await loadContacts(candidates.map((message) => message.contact));
    await loadExistingMessages(candidates.filter((message) => contactsByEmail.get(message.contact.toLowerCase())).map((message) => message.messageId!));
    for (let message of candidates) {
      const contactId = contactsByEmail.get(message.contact.toLowerCase());
      if (!contactId || existingMessages.has(message.messageId!)) continue;
      if (message.bodyLoaded === false && message.uid && message.uidValidity) {
        try { message = { ...message, ...await loadMailboxMessageContent(mailbox, message.uid, message.uidValidity) }; }
        catch (error) { console.warn("Unable to load automation reply:", error instanceof Error ? error.message : "Download failed"); continue; }
      }
      if (!message.messageId) continue;
      const references = [...(message.references ?? []), message.inReplyTo].filter(Boolean) as string[];
      const { data: parent } = references.length ? await admin.from("emails").select("thread_id").in("message_id", references).order("created_at", { ascending: false }).limit(1).maybeSingle().throwOnError() : { data: null };
      await admin.from("emails").upsert({ id: emailId(message.messageId), contact_id: contactId, direction: "received", subject: message.subject, body: message.body, message_id: message.messageId, thread_id: parent?.thread_id || threadKeyForEmail(message), status: "received", created_at: message.timestamp, owner_id: mailbox.type === "personal" ? mailbox.userId : null }, { onConflict: "id", ignoreDuplicates: true }).throwOnError();
      existingMessages.add(message.messageId);
    }
  }
}
