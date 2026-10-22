// Read-only mail protocol verification: receives messages, never sends mail.
// Run: node --env-file=.env.local --experimental-strip-types scripts/verify-email-sync.ts
import assert from "node:assert/strict";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { normalizeMailboxRow } from "../lib/mailbox-utils.ts";
import { fetchMailboxInboxMessages } from "../lib/email-inbox.ts";
import { loadSyncedMailbox, loadMailboxMessageContent, mailboxSyncKey } from "../lib/data/mailbox-sync.ts";
import { closeMailboxSessions } from "../lib/mailbox-imap.ts";

const admin = createSupabaseAdmin();
const { data } = await admin.from("workspace_mailboxes").select("*").eq("is_default", true).throwOnError();
let checked = 0;
for (const row of data ?? []) {
  const mailbox = normalizeMailboxRow(row);
  if (!mailbox?.isActive || !mailbox.imapHost || !mailbox.imapUsername || !mailbox.imapPassword) continue;
  if (process.argv.includes("--workspace") && mailbox.type !== "workspace") continue;
  checked += 1;
  if (process.argv.includes("--probe")) {
    const start = performance.now();
    try {
      const messages = await fetchMailboxInboxMessages(mailbox, { limit: 10, onProgress: (stage) => console.log(`${mailbox.type} +${Math.round(performance.now() - start)}ms: ${stage}`) });
      console.log(JSON.stringify({ mailbox: mailbox.type, messages: messages.length, durationMs: Math.round(performance.now() - start) }));
    } catch (error) {
      console.log(`${mailbox.type}: ${error instanceof Error ? error.message : "Receive failed"}`);
      process.exitCode = 1;
    }
    continue;
  }
  const start = performance.now();
  const synced = await loadSyncedMailbox(mailbox, { onProgress: (stage) => console.log(`${mailbox.type}: ${stage}`) });
  assert.equal(synced.error, null);
  const syncMs = Math.round(performance.now() - start);
  const { data: state } = await admin.from("mailbox_sync_state").select("uid_validity,last_uid").eq("mailbox_key", mailboxSyncKey(mailbox)).single().throwOnError();
  const incrementalStart = performance.now();
  const incremental = await fetchMailboxInboxMessages(mailbox, { cursor: { uidValidity: state.uid_validity, lastUid: state.last_uid } });
  const incrementalMs = Math.round(performance.now() - incrementalStart);
  const reloadStart = performance.now();
  const reload = await loadSyncedMailbox(mailbox, { sync: false });
  assert.deepEqual(reload.messages.map((message) => message.id), synced.messages.map((message) => message.id));
  assert.ok(reload.messages.every((message) => typeof message.body === "string" && typeof message.contact === "string"));
  console.log(JSON.stringify({ mailbox: mailbox.type, cachedMessages: synced.messages.length, syncMs, incrementalNewMessages: incremental.length, incrementalMs, savedReloadMs: Math.round(performance.now() - reloadStart), stableIds: true }));
  if (process.argv.includes("--content")) {
    const message = reload.messages.find((item) => item.uid && item.uidValidity);
    assert.ok(message);
    const contentStart = performance.now();
    const content = await loadMailboxMessageContent(mailbox, message.uid!, message.uidValidity!);
    assert.equal(content.bodyLoaded, true);
    assert.equal(content.messageId, message.messageId);
    assert.ok(content.body.trim());
    const contentMs = Math.round(performance.now() - contentStart);
    const cachedStart = performance.now();
    const cached = await loadMailboxMessageContent(mailbox, message.uid!, message.uidValidity!);
    assert.equal(cached.body, content.body);
    console.log(JSON.stringify({ mailbox: mailbox.type, contentMs, cachedContentMs: Math.round(performance.now() - cachedStart), bodyLoaded: true, attachments: content.attachments?.length ?? 0 }));
  }
}
assert.ok(checked, "No active default IMAP mailbox was available to verify.");
await closeMailboxSessions();
