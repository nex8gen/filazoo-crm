import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { normalizeMailboxRow } from "../mailbox-utils.ts";
import { FlowPreparationRetry } from "../flow-execution-errors.ts";

type Message = { id?: string; direction: string; body: string | null; body_loaded?: boolean; mailbox_id?: string | null; mailbox_uid?: number | null; mailbox_uid_validity?: number | null };

/** Hydration happens in a bounded action, never in the shared ingestion tick. */
export async function hydrateFlowMessages<T extends Message>(messages: T[], userId: string): Promise<T[]> {
  const db = createSupabaseAdmin();
  const result: T[] = [];
  const deadline = Date.now() + 30_000;
  for (const message of messages) {
    if (message.direction !== "received" || message.body_loaded !== false) { result.push(message); continue; }
    const { data } = await db.from("workspace_mailboxes").select("*").eq("id", message.mailbox_id).maybeSingle().throwOnError();
    const mailbox = normalizeMailboxRow(data);
    if (!mailbox?.isActive || mailbox.type === "personal" && mailbox.userId !== userId || !message.mailbox_uid || !message.mailbox_uid_validity) {
      throw new FlowPreparationRetry("The incoming message needs its authorized receiving mailbox before a reply can be prepared.", 60_000, "data");
    }
    const { loadMailboxMessageContent } = await import("./mailbox-sync.ts");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new FlowPreparationRetry("Incoming message content is still loading. Preparation will resume without sending an incomplete reply.", 60_000, "provider");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const full = await Promise.race([loadMailboxMessageContent(mailbox, message.mailbox_uid, message.mailbox_uid_validity), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new FlowPreparationRetry("Incoming message content timed out. No email was submitted.", 60_000, "provider")), remaining);
    })]).finally(() => clearTimeout(timer));
    if (message.id) await db.from("emails").update({ body: full.body, body_loaded: true }).eq("id", message.id).throwOnError();
    result.push({ ...message, body: full.body, body_loaded: true });
  }
  return result;
}

/** A stale receiving cache cannot establish that nobody replied. */
export async function requireFreshFlowMailbox(mailboxId: string, userId: string) {
  const { data } = await createSupabaseAdmin().from("workspace_mailboxes").select("*").eq("id", mailboxId).maybeSingle().throwOnError();
  const mailbox = normalizeMailboxRow(data);
  if (!mailbox?.isActive || mailbox.type === "personal" && mailbox.userId !== userId) throw new FlowPreparationRetry("The receiving mailbox is unavailable for this workflow sender.", 3_600_000, "configuration");
  const { loadSyncedMailbox } = await import("./mailbox-sync.ts");
  const snapshot = await loadSyncedMailbox(mailbox, { sync: false, includeContent: false });
  if (snapshot.error || !snapshot.syncedAt || !Number.isFinite(Date.parse(snapshot.syncedAt)) || Date.now() - Date.parse(snapshot.syncedAt) > 5 * 60_000) {
    throw new FlowPreparationRetry("Receiving is behind. The workflow will wait for a fresh inbox before deciding whether to reply or follow up.", 60_000, "provider");
  }
}
