import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxEmailItem } from "./email-inbox.ts";

export type MailboxSnapshotRow = {
  workspace_id?: string;
  mailbox_key: string;
  messages_revision?: string;
  messages: InboxEmailItem[];
  uid_validity: number | null;
  last_uid: number;
  synced_at: string | null;
  last_error: string | null;
  reconciled_at: string | null;
};
const legacyFields = "mailbox_key,messages,uid_validity,last_uid,synced_at,last_error,reconciled_at";
const metadataFields = "workspace_id,mailbox_key,messages_revision,uid_validity,last_uid,synced_at,last_error,reconciled_at";

/** Check current tenant-scoped metadata on every read. Only an unchanged
 * message payload is reused; authorization and sync status are never cached.
 */
export function createMailboxSnapshotReader({ maxBytes = 32 * 1024 * 1024, maxEntries = 64 } = {}) {
  const cache = new Map<string, { revision: string; json: string; bytes: number }>();
  let bytes = 0;
  const keyFor = (row: MailboxSnapshotRow) => row.workspace_id && row.messages_revision ? `${row.workspace_id}:${row.mailbox_key}` : null;
  function remember(row: MailboxSnapshotRow) {
    const key = keyFor(row);
    if (!key) return;
    const previous = cache.get(key);
    if (previous) { bytes -= previous.bytes; cache.delete(key); }
    const json = JSON.stringify(row.messages), size = Buffer.byteLength(json);
    if (size > maxBytes) return;
    while (cache.size && (bytes + size > maxBytes || cache.size >= maxEntries)) {
      const oldest = cache.keys().next().value!;
      bytes -= cache.get(oldest)!.bytes;
      cache.delete(oldest);
    }
    cache.set(key, { revision: row.messages_revision!, json, bytes: size });
    bytes += size;
  }
  return async function read(db: Pick<SupabaseClient, "from">, keys: string[], signal?: AbortSignal): Promise<MailboxSnapshotRow[]> {
    const unique = [...new Set(keys)];
    if (!unique.length) return [];
    signal?.throwIfAborted();
    const select = (fields: string, selected: string[]) => {
      const query = db.from("mailbox_sync_state").select(fields).in("mailbox_key", selected);
      return signal ? query.abortSignal(signal) : query;
    };
    const { data, error } = await select(metadataFields, unique);
    // Additive rollout: older databases remain readable without using a cache.
    if (error?.code === "42703" || error?.code === "PGRST204") {
      const legacy = await select(legacyFields, unique).throwOnError();
      return (legacy.data ?? []) as unknown as MailboxSnapshotRow[];
    }
    if (error) throw new Error(`Unable to load saved mailbox metadata: ${error.message}`);
    const metadata = (data ?? []) as unknown as MailboxSnapshotRow[];
    const rows = new Map<string, MailboxSnapshotRow>();
    const missing: string[] = [];
    for (const row of metadata) {
      const key = keyFor(row), saved = key ? cache.get(key) : undefined;
      if (saved && saved.revision === row.messages_revision) {
        cache.delete(key!); cache.set(key!, saved);
        // Each caller gets independent objects, including nested attachments.
        rows.set(row.mailbox_key, { ...row, messages: JSON.parse(saved.json) });
      } else missing.push(row.mailbox_key);
    }
    if (missing.length) {
      const { data: payloads } = await select(`${metadataFields},messages`, missing).throwOnError();
      for (const row of (payloads ?? []) as unknown as MailboxSnapshotRow[]) {
        rows.set(row.mailbox_key, row);
        remember(row);
      }
    }
    // Deleted or newly inaccessible rows never reappear from the cache.
    return metadata.flatMap(row => rows.has(row.mailbox_key) ? [rows.get(row.mailbox_key)!] : []);
  };
}

export const readMailboxSnapshots = createMailboxSnapshotReader();
