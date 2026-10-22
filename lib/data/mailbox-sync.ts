import { createHash } from "node:crypto";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { WorkspaceMailboxRecord } from "./mailboxes.ts";
import { synchronizeMailbox, type MailboxSnapshot, type MailboxSyncStore } from "../mailbox-sync.ts";
import type { InboxEmailItem } from "../email-inbox.ts";

function presentMailboxMessage(message: InboxEmailItem, key: string): InboxEmailItem {
  let html = message.html;
  const attachments = message.attachments?.map((attachment) => {
    if (!attachment.partId || !message.uid || !message.uidValidity) return attachment;
    const params = new URLSearchParams({ mailbox: key, uid: String(message.uid), validity: String(message.uidValidity), part: attachment.partId });
    const url = `/api/email/received-attachment?${params}`;
    if (attachment.cid && html) html = html.split(`cid:${attachment.cid}`).join(url.replaceAll("&", "&amp;"));
    return { ...attachment, url };
  });
  return { ...message, html, attachments, mailboxKey: key };
}

export async function loadMailboxMessageContent(mailbox: WorkspaceMailboxRecord, uid: number, uidValidity: number): Promise<InboxEmailItem> {
  const admin = createSupabaseAdmin();
  const key = mailboxSyncKey(mailbox);
  const { data } = await admin.from("mailbox_message_content").select("content").eq("mailbox_key", key).eq("uid_validity", uidValidity).eq("uid", uid).maybeSingle().throwOnError();
  if (data) return presentMailboxMessage(data.content as InboxEmailItem, key);
  const { receiveMailboxMessages } = await import("../mailbox-imap.ts");
  const [email] = await receiveMailboxMessages(mailbox, { uids: [uid], uidValidity, headersOnly: false });
  if (!email) throw new Error("This message is no longer available in the mailbox.");
  await admin.from("mailbox_message_content").upsert({ mailbox_key: key, uid_validity: uidValidity, uid, content: email }, { onConflict: "mailbox_key,uid_validity,uid" }).throwOnError();
  return presentMailboxMessage(email, key);
}

export function mailboxSyncKey(mailbox: Pick<WorkspaceMailboxRecord, "id" | "email" | "imapHost" | "imapUsername" | "imapPort">) {
  return createHash("sha256").update(JSON.stringify([mailbox.id, mailbox.email, mailbox.imapHost, mailbox.imapPort, mailbox.imapUsername])).digest("hex");
}

export async function loadSyncedMailbox(mailbox: WorkspaceMailboxRecord, options: { sync?: boolean; history?: boolean; onProgress?: (stage: string) => void } = {}) {
  const admin = createSupabaseAdmin();
  const key = mailboxSyncKey(mailbox);
  const store: MailboxSyncStore = {
    async read(): Promise<MailboxSnapshot> {
      const { data, error } = await admin.from("mailbox_sync_state").select("messages,uid_validity,last_uid,synced_at,last_error").eq("mailbox_key", key).maybeSingle();
      if (error) throw new Error(`Unable to load saved mailbox: ${error.message}`);
      return {
        messages: Array.isArray(data?.messages) ? data.messages as InboxEmailItem[] : [],
        cursor: data?.uid_validity ? { uidValidity: data.uid_validity, lastUid: data.last_uid } : undefined,
        syncedAt: data?.synced_at,
        error: data?.last_error,
      };
    },
    async acquire(token) {
      await admin.from("mailbox_sync_state").upsert({ mailbox_key: key }, { onConflict: "mailbox_key", ignoreDuplicates: true }).throwOnError();
      const { data } = await admin.from("mailbox_sync_state")
        .update({ lease_token: token, lease_until: new Date(Date.now() + 210000).toISOString() })
        .eq("mailbox_key", key).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
        .select("mailbox_key").maybeSingle().throwOnError();
      return Boolean(data);
    },
    async commit(token, snapshot) {
      const { data } = await admin.from("mailbox_sync_state").update({
        messages: snapshot.messages,
        uid_validity: snapshot.cursor!.uidValidity,
        last_uid: snapshot.cursor!.lastUid,
        synced_at: snapshot.syncedAt,
        last_error: null,
        lease_token: null,
        lease_until: null,
      }).eq("mailbox_key", key).eq("lease_token", token).select("mailbox_key").maybeSingle().throwOnError();
      if (!data) throw new Error("Mailbox sync lease expired; the next check will retry.");
    },
    async fail(token, error) {
      await admin.from("mailbox_sync_state").update({ last_error: error, lease_token: null, lease_until: null })
        .eq("mailbox_key", key).eq("lease_token", token).throwOnError();
    },
  };
  const { fetchMailboxInboxMessages } = await import("../email-inbox.ts");
  const snapshot = await synchronizeMailbox(store, (fetchOptions) => fetchMailboxInboxMessages(mailbox, { ...fetchOptions, onProgress: options.onProgress }), options);
  const { data: cachedBodies } = snapshot.cursor ? await admin.from("mailbox_message_content").select("uid,content")
    .eq("mailbox_key", key).eq("uid_validity", snapshot.cursor.uidValidity).order("uid", { ascending: false }).limit(1000).throwOnError() : { data: [] };
  const byUid = new Map((cachedBodies ?? []).map((row) => [row.uid, row.content as InboxEmailItem]));
  return { messages: snapshot.messages.map((message) => presentMailboxMessage({ ...message, ...byUid.get(message.uid) }, key)), error: snapshot.error ?? null, syncedAt: snapshot.syncedAt ?? null };
}
