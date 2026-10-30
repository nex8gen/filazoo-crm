// Receive-only provider verification. Never sends or changes provider messages.
import assert from "node:assert/strict";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { normalizeMailboxRow } from "../lib/mailbox-utils.ts";
import { listMailboxFolders, receiveMailboxMessages, reconcileMailboxMessages, searchMailboxMessages, closeMailboxSessions } from "../lib/mailbox-imap.ts";
import { loadMailboxWorkspace } from "../lib/data/mailbox-sync.ts";
import Imap from "imap";

const { data } = await createSupabaseAdmin().from("workspace_mailboxes").select("*").eq("type", "workspace").eq("is_default", true).single().throwOnError();
const mailbox = normalizeMailboxRow(data)!;
try {
  const saved = await loadMailboxWorkspace(mailbox, { sync: false });
  const folders = await listMailboxFolders(mailbox);
  const sent = folders.find((folder) => folder.kind === "sent");
  assert.ok(sent, "The provider must expose a Sent folder.");
  const messages = await receiveMailboxMessages(mailbox, { folder: sent.path, kind: "sent", limit: 2 });
  assert.ok(messages.length);
  assert.ok(messages.every((message) => message.direction === "outbound" && message.to?.length && message.providerFolder === sent.path));
  const reconciled = await reconcileMailboxMessages(mailbox, messages, sent.path);
  assert.ok(reconciled.every((message) => !message.providerRemoved));
  const query = messages[0].from || mailbox.email!;
  if (process.argv.includes("--diagnose")) {
    const connection = new Imap({ user: mailbox.imapUsername!, password: mailbox.imapPassword!, host: mailbox.imapHost!, port: mailbox.imapPort || 993, tls: true, tlsOptions: { rejectUnauthorized: true, servername: mailbox.imapHost! }, connTimeout: 15000, authTimeout: 15000 });
    try {
      await new Promise<void>((resolve, reject) => { connection.once("ready", resolve); connection.once("error", reject); connection.connect(); });
      await new Promise<void>((resolve, reject) => connection.openBox(sent.path, true, (error) => error ? reject(error) : resolve()));
      const checks = ["ALL", "FROM", "TO", "SUBJECT", "TEXT"];
      for (const field of checks) {
        const criteria = field === "ALL" ? ["ALL"] : [[field, field === "SUBJECT" ? messages[0].subject : query]];
        const ids = await new Promise<number[]>((resolve, reject) => connection.search(criteria, (error, ids) => error ? reject(error) : resolve(ids)));
        console.log(JSON.stringify({ field, count: ids.length, hasSample: ids.includes(messages[0].uid!), newestUID: Math.max(0, ...ids), sampleUID: messages[0].uid }));
      }
    } finally { connection.end(); }
  }
  const results = await searchMailboxMessages(mailbox, query, sent.path, "sent");
  assert.ok(results.some((message) => message.from === messages[0].from), "Provider search must find messages from the sampled sender.");
  console.log(JSON.stringify({ savedMessages: saved.messages.length, providerFolders: folders.length, sentRecipients: true, flagsReconciled: true, providerSearch: true, sentMail: false }));
} finally { await closeMailboxSessions(); }
