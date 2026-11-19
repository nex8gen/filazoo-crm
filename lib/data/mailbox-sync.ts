import { createHash } from "node:crypto";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { WorkspaceMailboxRecord } from "./mailboxes.ts";
import { synchronizeMailbox, readMailboxWithFallback, withInboxReadBudget, type MailboxSnapshot, type MailboxSyncStore } from "../mailbox-sync.ts";
import { providerFolderKind } from "../email-provider.ts";
import type { InboxEmailItem } from "../email-inbox.ts";
import { resolveEmailContentIds, plainEmailContentHtml } from "../email-content.ts";
import { decodeEmailFilename } from "../email-mime.ts";
import type { ProviderFolder } from "../email-provider.ts";
import { readMailboxSnapshots } from "../mailbox-snapshot-reader.ts";

function presentMailboxMessage(message: InboxEmailItem, key: string): InboxEmailItem {
  const attachments = message.attachments?.map((attachment) => {
    const filename = decodeEmailFilename(attachment.filename);
    if (!attachment.partId || !message.uid || !message.uidValidity) return { ...attachment, filename };
    const params = new URLSearchParams({ mailbox: key, uid: String(message.uid), validity: String(message.uidValidity), part: attachment.partId, folder: message.providerFolder || "INBOX" });
    const url = `/api/email/received-attachment?${params}`;
    return { ...attachment, filename, url };
  });
  const html = message.html ? resolveEmailContentIds(message.html, attachments ?? []) : plainEmailContentHtml(message.body || "", attachments ?? []);
  return { ...message, html, attachments, mailboxKey: key };
}

export async function loadMailboxMessageContent(mailbox: WorkspaceMailboxRecord, uid: number, uidValidity: number, folder = "INBOX", options: { defer?: (work: () => Promise<void>) => void } = {}): Promise<InboxEmailItem> {
  const admin = createSupabaseAdmin();
  const key = mailboxSyncKey(mailbox, folder);
  let cached: (InboxEmailItem & { mimeVersion?: number }) | undefined;
  const read = async (signal?: AbortSignal) => {
    let query = admin.from("mailbox_message_content").select("content").eq("mailbox_key", key).eq("uid_validity", uidValidity).eq("uid", uid);
    if (signal) query = query.abortSignal(signal);
    const { data } = await query.maybeSingle().throwOnError();
    return data?.content as (InboxEmailItem & { mimeVersion?: number }) | undefined;
  };
  try { cached = options.defer ? await withInboxReadBudget(read) : await read(); }
  catch (error) { if (!options.defer) throw error; }
  const needsRepair = cached && cached.mimeVersion !== 2 && (!cached.html && /\[cid:/i.test(cached.body || "") || cached.bodyLoaded === false);
  if (cached && !needsRepair) return presentMailboxMessage(cached, key);
  const { receiveMailboxMessages, withMailboxSyncSessions } = await import("../mailbox-imap.ts");
  const folders = folder === "INBOX" || options.defer ? [] : await savedProviderFolders(mailbox);
  let email: InboxEmailItem | undefined;
  try {
    const receive = () => receiveMailboxMessages(mailbox, { uids: [uid], uidValidity, headersOnly: false, folder, kind: folders.find((item) => item.path === folder)?.kind || providerFolderKind(folder, []), preferModernTransport: true });
    [email] = options.defer ? await withMailboxSyncSessions(receive, 8000) : await receive();
  }
  catch (error) { if (cached) return presentMailboxMessage(cached, key); throw error; }
  if (!email) { if (cached) return presentMailboxMessage(cached, key); throw new Error("This message is no longer available in the mailbox."); }
  const save = async () => {
    await admin.from("mailbox_sync_state").upsert({ mailbox_key: key }, { onConflict: "mailbox_key", ignoreDuplicates: true }).throwOnError();
    await admin.from("mailbox_message_content").upsert({ mailbox_key: key, uid_validity: uidValidity, uid, content: { ...email, mimeVersion: 2 } }, { onConflict: "mailbox_key,uid_validity,uid" }).throwOnError();
  };
  if (options.defer) options.defer(async () => { try { await save(); } catch { console.warn("Email content cache will retry when opened again."); } });
  else await save();
  return presentMailboxMessage(email, key);
}

export function mailboxSyncKey(mailbox: Pick<WorkspaceMailboxRecord, "id" | "email" | "imapHost" | "imapUsername" | "imapPort">, folder = "INBOX") {
  return createHash("sha256").update(JSON.stringify([mailbox.id, mailbox.email, mailbox.imapHost, mailbox.imapPort, mailbox.imapUsername, ...(folder === "INBOX" ? [] : [folder])])).digest("hex");
}

export async function loadSyncedMailbox(mailbox: WorkspaceMailboxRecord, options: { sync?: boolean; history?: boolean; historyLimit?: number; includeContent?: boolean; onProgress?: (stage: string) => void; folder?: string; kind?: string; phase?: "headers" | "previews" | "flags"; batchSize?: number; worker?: { account: string; token: string } } = {}) {
  const admin = createSupabaseAdmin();
  const key = mailboxSyncKey(mailbox, options.folder);
  let saved: MailboxSnapshot | undefined;
  let reconciledAt: string | null = null;
  const maintenance = options.phase === "previews" || options.phase === "flags";
  const preserveFreshness = maintenance || options.history;
  const store: MailboxSyncStore = {
    async read(): Promise<MailboxSnapshot> {
      const [data] = await readMailboxSnapshots(admin, [key]);
      reconciledAt = data?.reconciled_at ?? null;
      saved = {
        messages: Array.isArray(data?.messages) ? data.messages as InboxEmailItem[] : [],
        cursor: data?.uid_validity ? { uidValidity: data.uid_validity, lastUid: data.last_uid } : undefined,
        syncedAt: data?.synced_at,
        error: data?.last_error,
      };
      return saved;
    },
    async acquire(token) {
      await admin.from("mailbox_sync_state").upsert({ mailbox_key: key }, { onConflict: "mailbox_key", ignoreDuplicates: true }).throwOnError();
      const { data } = await admin.from("mailbox_sync_state")
        .update({ lease_token: token, lease_until: new Date(Date.now() + 210000).toISOString() })
        .eq("mailbox_key", key).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
        .select("mailbox_key").maybeSingle().throwOnError();
      if (!data && options.worker) throw new Error("Mailbox snapshot is still leased; this job will retry.");
      return Boolean(data);
    },
    async commit(token, snapshot, options) {
      const messagesChanged = options?.messagesChanged ?? true;
      if (preserveFreshness) snapshot.syncedAt = saved?.syncedAt;
      const update = {
        ...(messagesChanged ? { messages: snapshot.messages } : {}),
        uid_validity: snapshot.cursor!.uidValidity, last_uid: snapshot.cursor!.lastUid,
        synced_at: snapshot.syncedAt, reconciled_at: reconciledAt, maintenance: Boolean(preserveFreshness),
      };
      if (workerOwner) {
        const { data } = await admin.rpc("commit_mail_sync_snapshot", { p_account: workerOwner.account, p_owner: workerOwner.token, p_key: key, p_lease: token, p_snapshot: update }).throwOnError();
        if (!data) throw new Error("Mailbox worker ownership expired; the next worker will resume.");
        return;
      }
      const { data } = await admin.from("mailbox_sync_state").update({
        ...(messagesChanged ? { messages: snapshot.messages, uid_validity: snapshot.cursor!.uidValidity } : {}),
        last_uid: snapshot.cursor!.lastUid,
        ...(!preserveFreshness ? { synced_at: snapshot.syncedAt } : {}),
        reconciled_at: reconciledAt,
        ...(!preserveFreshness ? { last_error: null } : {}),
        lease_token: null,
        lease_until: null,
      }).eq("mailbox_key", key).eq("lease_token", token).select("mailbox_key").maybeSingle().throwOnError();
      if (!data) throw new Error("Mailbox sync lease expired; the next check will retry.");
    },
    async fail(token, error) {
      await admin.from("mailbox_sync_state").update({ ...(!preserveFreshness ? { last_error: error } : {}), lease_token: null, lease_until: null })
        .eq("mailbox_key", key).eq("lease_token", token).throwOnError();
    },
  };
  const workerOwner = options.worker;
  const { fetchMailboxInboxMessages } = await import("../email-inbox.ts");
  const snapshot = await synchronizeMailbox(store, async (fetchOptions) => {
    if (maintenance && saved?.cursor) {
      fetchOptions.onMailbox(saved.cursor);
      if (options.phase === "flags") {
        const { reconcileMailboxMessages } = await import("../mailbox-imap.ts");
        const messages = await reconcileMailboxMessages(mailbox, saved.messages, options.folder);
        reconciledAt = new Date().toISOString();
        return messages;
      }
      const pendingPreviews = saved.messages.filter((message) => !message.providerRemoved && !message.preview?.trim() && !message.previewAttemptedAt && message.uid);
      const previewBatch = Math.max(1, Math.min(50, options.batchSize || 25));
      const missingPreviews = pendingPreviews.slice(0, previewBatch);
      fetchOptions.onBatch({ received: missingPreviews.length, hasMore: pendingPreviews.length > missingPreviews.length });
      if (missingPreviews.length) {
        return (await fetchMailboxInboxMessages(mailbox, { limit: previewBatch, uids: missingPreviews.map((message) => message.uid!), uidValidity: saved.cursor.uidValidity, folder: options.folder, kind: options.kind })).map((message) => ({ ...message, previewAttemptedAt: new Date().toISOString() }));
      }
      return [];
    }
    // Commit new headers before any body previews or expensive flag scans.
    return fetchMailboxInboxMessages(mailbox, { ...fetchOptions, includePreview: false, onProgress: options.onProgress, folder: options.folder, kind: options.kind });
  }, { ...options, force: Boolean(options.worker) || maintenance });
  const visibleMessages = snapshot.messages.filter((message) => !message.providerRemoved).map((message) => ({ ...message, mailboxId: mailbox.id, providerFolder: options.folder || "INBOX", providerKind: options.kind || "inbox" }));
  // Inbox lists need headers only. Bodies are served by the message endpoint
  // when opened, rather than downloading every cached HTML body on each poll.
  if (options.includeContent === false) return { messages: visibleMessages.map((message) => presentMailboxMessage(message, key)), error: snapshot.error ?? null, syncedAt: snapshot.syncedAt ?? null, batch: snapshot.batch };
  const { data: cachedBodies } = snapshot.cursor ? await admin.from("mailbox_message_content").select("uid,content")
    .eq("mailbox_key", key).eq("uid_validity", snapshot.cursor.uidValidity).order("uid", { ascending: false }).limit(1000).throwOnError() : { data: [] };
  const byUid = new Map((cachedBodies ?? []).map((row) => [row.uid, row.content as InboxEmailItem]));
  return { messages: visibleMessages.map((message) => presentMailboxMessage({ ...byUid.get(message.uid), ...message, ...(byUid.get(message.uid) ? { body: byUid.get(message.uid)!.body, html: byUid.get(message.uid)!.html, bodyLoaded: true } : {}) }, key)), error: snapshot.error ?? null, syncedAt: snapshot.syncedAt ?? null };
}

export async function savedProviderFolders(mailbox: WorkspaceMailboxRecord, signal?: AbortSignal): Promise<ProviderFolder[]> {
  let query = createSupabaseAdmin().from("mailbox_provider_folders").select("folders").eq("mailbox_key", mailboxSyncKey(mailbox));
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) return [];
  return ((data?.folders || []) as ProviderFolder[]).map(folder => folder.path.toUpperCase() === "INBOX" ? { ...folder, path: "INBOX", kind: "inbox" } : folder);
}

/** Read saved messages only. Refresh requests enqueue durable work. */
type MailboxWorkspaceSnapshot = { messages: InboxEmailItem[]; folders: ProviderFolder[]; error: string | null; syncedAt: string | null; partial: boolean };
export async function loadMailboxWorkspace(mailbox: WorkspaceMailboxRecord, options: { sync?: boolean; history?: boolean; folder?: string; interactive?: boolean; signal?: AbortSignal } = {}): Promise<MailboxWorkspaceSnapshot> {
  if (options.interactive) {
    return readMailboxWithFallback(
      async signal => {
        const saved = await loadMailboxWorkspace(mailbox, { ...options, interactive: false, sync: false, signal });
        // No successful checkpoint means an initial import has never completed;
        // it is not evidence that the real mailbox is empty.
        if (!saved.syncedAt || saved.error && !saved.messages.length) throw new Error("Saved mailbox history is not ready.");
        return saved;
      },
      async () => {
        const { receiveMailboxMessages, withMailboxSyncSessions } = await import("../mailbox-imap.ts");
        const folder = options.folder || "INBOX";
        const kind = providerFolderKind(folder, []);
        const messages = await withMailboxSyncSessions(() => receiveMailboxMessages(mailbox, { limit: 50, folder, kind, headersOnly: true, includePreview: false }), 8000);
        const key = mailboxSyncKey(mailbox, folder);
        return { messages: messages.map(message => presentMailboxMessage({ ...message, mailboxId: mailbox.id }, key)),
          folders: [{ path: folder, name: folder, kind }], error: null, syncedAt: new Date().toISOString(), partial: true };
      },
    );
  }
  const db = createSupabaseAdmin();
  const folders = await savedProviderFolders(mailbox, options.signal);
  if (options.sync !== false) {
    const { enqueueMailboxSync } = await import("./mail-sync-worker.ts");
    await enqueueMailboxSync(mailbox, { history: options.history, folder: options.folder });
  }
  const folderList = [{ path: "INBOX", kind: "inbox" }, ...folders.filter((folder) => folder.kind !== "inbox")];
  const byKey = new Map(folderList.map((folder) => [mailboxSyncKey(mailbox, folder.path), folder]));
  const cached = await readMailboxSnapshots(db, [...byKey.keys()], options.signal);
  const snapshots = (cached || []).map((row) => {
    const folder = byKey.get(row.mailbox_key)!;
    return { kind: folder.kind, messages: (row.messages as InboxEmailItem[]).filter((message) => !message.providerRemoved).map((message) => presentMailboxMessage({ ...message, mailboxId: mailbox.id, providerFolder: folder.path, providerKind: folder.kind }, row.mailbox_key)), error: row.last_error, syncedAt: row.synced_at };
  });
  const messages = new Map<string, InboxEmailItem>();
  // Inbox/Sent win over All Mail copies; keep one representation per Message-ID.
  const folderPriority: Record<string, number> = { sent: 5, inbox: 4, drafts: 3, spam: 2, trash: 2, custom: 1, archive: 0 };
  for (const snapshot of snapshots.sort((a, b) => (folderPriority[b.kind] ?? 0) - (folderPriority[a.kind] ?? 0))) {
    for (const message of snapshot.messages) {
      const location = { folder: message.providerFolder!, kind: message.providerKind!, mailboxKey: message.mailboxKey!, uid: message.uid!, validity: message.uidValidity! };
      const existing = messages.get(message.id);
      if (existing) existing.providerLocations = [...existing.providerLocations || [], location];
      else messages.set(message.id, { ...message, providerLocations: [location] });
    }
  }
  const inbox = cached?.find((row) => row.mailbox_key === mailboxSyncKey(mailbox));
  return { messages: [...messages.values()], folders, error: inbox?.last_error || null, syncedAt: inbox?.synced_at || null, partial: false };
}
