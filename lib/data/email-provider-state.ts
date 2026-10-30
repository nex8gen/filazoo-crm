import type { WorkspaceViewer } from "../auth";
import { canViewEmail } from "../email-access";
import { validProviderFolder } from "../email-provider";
import { getAssignedEmailContacts } from "./email-access";
import { getViewerMailboxes, mailboxHasImap } from "./mailboxes";
import { mailboxSyncKey, loadSyncedMailbox, loadMailboxMessageContent, savedProviderFolders } from "./mailbox-sync";
import { updateMailboxMessage } from "../mailbox-imap";
import { createSupabaseAdmin } from "../supabase/admin";

export async function syncProviderState(viewer: WorkspaceViewer, _messageKey: string, source: { mailboxKey: string; uid: number; validity: number; folder: string; read?: boolean; starred?: boolean; destination?: "inbox" | "archive" | "trash" }) {
  if (!validProviderFolder(source.folder)) throw new Error("Invalid provider folder.");
  const mailbox = (await getViewerMailboxes(viewer.id)).find((item) => mailboxSyncKey(item, source.folder) === source.mailboxKey);
  if (!mailbox || !mailboxHasImap(mailbox)) throw new Error("Mailbox unavailable.");
  const snapshot = await loadSyncedMailbox(mailbox, { sync: false, includeContent: false, folder: source.folder });
  const message = snapshot.messages.find((item) => item.uid === source.uid && item.uidValidity === source.validity) || await loadMailboxMessageContent(mailbox, source.uid, source.validity, source.folder);
  if (!message || !canViewEmail(viewer, message.contact, mailbox.type === "personal" ? null : await getAssignedEmailContacts(viewer), mailbox)) throw new Error("Email unavailable.");
  let destination: string | undefined;
  if (source.destination) {
    let folders = await savedProviderFolders(mailbox);
    if (source.destination === "archive" && !folders.some((folder) => folder.kind === "archive")) {
      const { ensureMailboxArchive } = await import("../mailbox-imap");
      folders = await ensureMailboxArchive(mailbox);
      await createSupabaseAdmin().from("mailbox_provider_folders").upsert({ mailbox_key: mailboxSyncKey(mailbox), folders, synced_at: new Date().toISOString() }).throwOnError();
    }
    destination = source.destination === "inbox" ? "INBOX" : folders.find((folder) => folder.kind === source.destination)?.path;
    if (!destination) throw new Error(`The provider has no ${source.destination} folder. Refresh to discover its folders.`);
  }
  await updateMailboxMessage(mailbox, source.uid, source.validity, source.folder, { read: source.read, starred: source.starred, destination });
  // Keep the cached source UID as a tombstone until the destination is imported.
  // The history-preservation trigger intentionally retains these tombstones.
  const db = createSupabaseAdmin();
  const { data } = await db.from("mailbox_sync_state").select("messages").eq("mailbox_key", source.mailboxKey).single().throwOnError();
  const messages = data.messages.map((item: typeof message) => item.id !== message.id ? item : ({ ...item,
    ...(source.read !== undefined ? { read: source.read } : {}), ...(source.starred !== undefined ? { starred: source.starred } : {}),
    ...(destination && destination !== source.folder ? { providerRemoved: true } : {}) }));
  await db.from("mailbox_sync_state").update({ messages, reconciled_at: null }).eq("mailbox_key", source.mailboxKey).throwOnError();
}
