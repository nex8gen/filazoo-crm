import type { InboxEmailItem } from "./email-inbox.ts";

export type MailboxCursor = { uidValidity: number; lastUid: number };
export type MailboxSnapshot = {
  messages: InboxEmailItem[];
  cursor?: MailboxCursor;
  syncedAt?: string | null;
  error?: string | null;
};

export function selectMailboxUids(results: number[], limit: number, startUid = 0) {
  // RFC IMAP ranges are inclusive: n:* can include an old UID if n > max.
  const available = results.filter((uid) => uid >= startUid).sort((a, b) => a - b);
  const size = Math.max(1, Math.min(limit, 1000));
  return startUid ? available.slice(0, size) : available.slice(-size);
}

export function mergeMailboxSnapshot(previous: MailboxSnapshot, messages: InboxEmailItem[], cursor: MailboxCursor): MailboxSnapshot {
  const sameMailboxEpoch = previous.cursor?.uidValidity === cursor.uidValidity;
  const byId = new Map((sameMailboxEpoch ? previous.messages : []).map((message) => [message.id, message]));
  for (const message of messages) byId.set(message.id, message);
  return {
    // Bound the UI cache; importing history expands the initial 100 to 1000.
    messages: [...byId.values()].sort((a, b) => (b.uid ?? 0) - (a.uid ?? 0)).slice(0, 1000),
    cursor: sameMailboxEpoch ? { ...cursor, lastUid: Math.max(cursor.lastUid, previous.cursor!.lastUid) } : cursor,
    syncedAt: new Date().toISOString(),
    error: null,
  };
}

export type MailboxSyncStore = {
  read(): Promise<MailboxSnapshot>;
  acquire(token: string): Promise<boolean>;
  commit(token: string, snapshot: MailboxSnapshot): Promise<void>;
  fail(token: string, error: string): Promise<void>;
};

export async function synchronizeMailbox(
  store: MailboxSyncStore,
  fetchMessages: (options: { limit: number; cursor?: MailboxCursor; beforeUid?: number; onMailbox: (cursor: MailboxCursor) => void }) => Promise<InboxEmailItem[]>,
  { sync = true, history = false }: { sync?: boolean; history?: boolean } = {},
): Promise<MailboxSnapshot> {
  const saved = await store.read();
  if (history && saved.messages.length >= 1000) return saved;
  if (!sync || (!history && saved.syncedAt && Date.now() - Date.parse(saved.syncedAt) < 5000)) return saved;
  const token = crypto.randomUUID();
  if (!await store.acquire(token)) return store.read();
  try {
    // Re-read after taking the lease: a different server may have just synced.
    const previous = await store.read();
    let nextCursor: MailboxCursor | undefined;
    const knownUids = previous.messages.flatMap((message) => Number.isSafeInteger(message.uid) && message.uid! > 0 ? [message.uid!] : []);
    const messages = await fetchMessages({
      limit: history ? 25 : 10,
      cursor: previous.cursor,
      beforeUid: history && knownUids.length ? Math.min(...knownUids) : undefined,
      onMailbox: (cursor) => { nextCursor = cursor; },
    });
    if (!nextCursor) throw new Error("Mailbox sync ended without a valid UID checkpoint.");
    const snapshot = mergeMailboxSnapshot(previous, messages, nextCursor);
    await store.commit(token, snapshot);
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync mailbox.";
    await store.fail(token, message);
    return { ...await store.read(), error: message };
  }
}
