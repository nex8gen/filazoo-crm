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
  const { data: activeFlows } = await admin.from("flows").select("user_id").eq("status", "live").throwOnError();
  const users = [...new Set((activeFlows ?? []).map((flow) => flow.user_id))];
  const { data: outbound } = users.length ? await admin.from("mailbox_sent_messages").select("*").in("user_id", users).order("sent_at", { ascending: false }).limit(1000).throwOnError() : { data: [] };
  for (const message of outbound ?? []) {
    if (!message.message_id || message.status !== "sent") continue;
    const { data: contact } = await admin.from("contacts").select("id").eq("email", message.to_email).maybeSingle().throwOnError();
    if (!contact) continue;
    const { data: existing } = await admin.from("emails").select("id").eq("message_id", message.message_id).limit(1).maybeSingle().throwOnError();
    if (existing) continue;
    await admin.from("emails").upsert({ id: emailId(message.message_id), contact_id: contact.id, direction: "sent", subject: message.subject, body: message.body, message_id: message.message_id, thread_id: message.thread_key || `message:${normalizeMessageId(message.message_id)}`, status: "sent", sent_at: message.sent_at, created_at: message.sent_at, owner_id: message.user_id }, { onConflict: "id", ignoreDuplicates: true }).throwOnError();
  }
  const { data: mailboxes } = await admin.from("workspace_mailboxes").select("*").eq("is_active", true).throwOnError();
  const ownAddresses = new Set((mailboxes ?? []).map((row) => String(row.email).trim().toLowerCase()));
  const { loadSyncedMailbox, loadMailboxMessageContent } = await import("./mailbox-sync.ts");
  for (const row of mailboxes ?? []) {
    const mailbox = normalizeMailboxRow(row);
    if (!mailbox?.imapHost || !mailbox.imapUsername || !mailbox.imapPassword) continue;
    let inbound;
    try {
      const result = await loadSyncedMailbox(mailbox);
      if (result.error) console.warn("Background mailbox sync:", result.error);
      inbound = result.messages;
    } catch (error) {
      console.warn("Background mailbox sync failed:", error instanceof Error ? error.message : "Unknown error");
      continue;
    }
    // Cache normal incoming mail even with no active automation. Only project
    // messages into the automation tables for the flows' authorized mailboxes.
    if (!users.length || (mailbox.type === "personal" && !users.includes(mailbox.userId ?? ""))) continue;
    for (let message of inbound) {
      if (!message.messageId) continue;
      // A copy of our own outgoing email is not a new customer inquiry.
      if (ownAddresses.has(message.contact.trim().toLowerCase())) continue;
      const { data: contact } = await admin.from("contacts").select("id").eq("email", message.contact).maybeSingle().throwOnError();
      if (!contact) continue;
      const { data: existing } = await admin.from("emails").select("id").eq("message_id", message.messageId).limit(1).maybeSingle().throwOnError();
      if (existing) continue;
      if (message.bodyLoaded === false && message.uid && message.uidValidity) {
        try { message = { ...message, ...await loadMailboxMessageContent(mailbox, message.uid, message.uidValidity) }; }
        catch (error) { console.warn("Unable to load automation reply:", error instanceof Error ? error.message : "Download failed"); continue; }
      }
      if (!message.messageId) continue;
      const references = [...(message.references ?? []), message.inReplyTo].filter(Boolean) as string[];
      const { data: parent } = references.length ? await admin.from("emails").select("thread_id").in("message_id", references).order("created_at", { ascending: false }).limit(1).maybeSingle().throwOnError() : { data: null };
      await admin.from("emails").upsert({ id: emailId(message.messageId), contact_id: contact.id, direction: "received", subject: message.subject, body: message.body, message_id: message.messageId, thread_id: parent?.thread_id || threadKeyForEmail(message), status: "received", created_at: message.timestamp, owner_id: mailbox.type === "personal" ? mailbox.userId : null }, { onConflict: "id", ignoreDuplicates: true }).throwOnError();
    }
  }
}
