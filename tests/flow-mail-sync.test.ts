import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as threading from "../lib/email-threading.ts";

type Row = Record<string, unknown>;
const require = createRequire(import.meta.url);
function setup({ messages = [] as Row[], contacts = [] as Row[], emails = [] as Row[], sent = [] as Row[], personalOwner = "owner", live = true } = {}) {
  const mailbox = { id: "mailbox", userId: personalOwner, type: "personal", email: "sales@example.com", is_active: true, imapHost: "imap.test", imapUsername: "sales", imapPassword: "fixture" };
  const tables: Record<string, Row[]> = { flows: live ? [{ user_id: "owner", status: "live" }] : [], contacts, emails, mailbox_message_content: [{ mailbox_key: "fixture", uid_validity: 1, uid: 2, content: { body: "Full customer message" } }], mailbox_sent_messages: sent, workspace_mailboxes: [mailbox] };
  const lookups: Array<{ table: string; column: string; values: unknown[] }> = [];
  const bodyReads: number[] = [];
  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let single = false;
    const query = {
      select() { return query; },
      eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query; },
      in(column: string, values: unknown[]) {
        lookups.push({ table, column, values });
        filters.push(row => values.includes(column === "email" ? String(row[column]).toLowerCase() : row[column]));
        return query;
      },
      order() { return query; }, limit() { return query; },
      or() { return query; },
      maybeSingle() { single = true; return query; }, throwOnError() { return query; },
      upsert(input: Row | Row[]) { for (const row of Array.isArray(input) ? input : [input]) { const old = tables[table].find(existing => existing.id === row.id); if (old) Object.assign(old, row); else tables[table].push(row); } return query; },
      then(resolve: (value: unknown) => unknown) {
        const rows = tables[table].filter(row => filters.every(filter => filter(row)));
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
      },
    };
    return query;
  }
  const exports = {} as { syncFlowMailboxMessages: (options?: { mailboxId?: string; contactId?: string }) => Promise<void> };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-mail-projection.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from }) },
    "../mailbox-utils.ts": { normalizeMailboxRow: (row: Row) => row },
    "../email-threading.ts": threading,
    "./mailbox-sync.ts": {
      mailboxSyncKey: () => "fixture",
      loadSyncedMailbox: async (_mailbox: Row, options: { includeContent: boolean }) => {
        assert.equal(options.includeContent, false, "background scans must read headers only");
        return { messages, error: null };
      },
      loadMailboxMessageContent: async (_mailbox: Row, uid: number) => { bodyReads.push(uid); return { body: "Full customer message", bodyLoaded: true }; },
    },
  };
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Map, Set, console });
  return { run: exports.syncFlowMailboxMessages, tables, lookups, bodyReads };
}

function message(uid: number, contact: string): Row {
  return { id: `imap-${uid}`, messageId: `<mail-${uid}@test>`, uid, uidValidity: 1, contact, subject: "Customer inquiry", body: "", bodyLoaded: false, timestamp: "2026-10-30T00:00:00Z" };
}

test("large inboxes batch unknown senders and never download their bodies", async () => {
  const app = setup({ messages: Array.from({ length: 1568 }, (_, uid) => message(uid + 1, `unknown-${uid}@test`)) });
  await app.run();
  const contacts = app.lookups.filter(read => read.table === "contacts");
  assert.equal(contacts.length, 16);
  assert.ok(contacts.every(read => read.values.length <= 100));
  assert.equal(app.bodyReads.length, 0);
  assert.equal(app.tables.emails.length, 0);
});

test("CRM receipts preserve case-insensitive matches, cached content and personal ownership without downloading", async () => {
  const app = setup({
    contacts: [{ id: "contact", email: "BUYER@example.com" }],
    emails: [{ id: "old", message_id: "<mail-1@test>", thread_id: "existing-thread", body_loaded: true }],
    messages: [message(1, "buyer@example.com"), { ...message(2, "Buyer@example.com"), inReplyTo: "<mail-1@test>" }, message(3, "sales@example.com")],
  });
  await app.run();
  assert.deepEqual(app.bodyReads, []);
  assert.equal(app.tables.emails.length, 2);
  const saved = app.tables.emails[1];
  assert.equal(saved.contact_id, "contact");
  assert.equal(saved.thread_id, "existing-thread");
  assert.equal(saved.owner_id, "owner");
  assert.equal(saved.body, "Full customer message");
  assert.equal(app.lookups.filter(read => read.table === "contacts").length, 1);
  await app.run();
  assert.equal(app.tables.emails.length, 2, "rescans must not duplicate saved messages");
  assert.deepEqual(app.bodyReads, []);
});

test("sent mail uses the same batched matching and excludes unaccepted deliveries", async () => {
  const app = setup({ contacts: [{ id: "contact", email: "buyer@example.com" }], sent: [
    { user_id: "owner", to_email: "BUYER@example.com", status: "sent", message_id: "<outbound@test>", body: "Quote", thread_key: "thread", sent_at: "2026-10-30T00:00:00Z" },
    { user_id: "owner", to_email: "buyer@example.com", status: "failed", message_id: "<failed@test>" },
  ] });
  await app.run();
  assert.equal(app.tables.emails.length, 1);
  assert.equal(app.tables.emails[0].direction, "sent");
  assert.equal(app.tables.emails[0].contact_id, "contact");
  assert.equal(app.tables.emails[0].thread_id, "thread");
});

test("targeted final checks exclude every internal mailbox address, including other personal mailboxes", async () => {
  const app = setup({ contacts: [{ id: "internal-contact", email: "teammate@example.com" }], messages: [message(1, "teammate@example.com")] });
  app.tables.workspace_mailboxes.push({ ...app.tables.workspace_mailboxes[0], id: "teammate-mailbox", userId: "teammate", email: "teammate@example.com" });
  await app.run({ mailboxId: "mailbox" });
  assert.equal(app.tables.emails.length, 0);
});

test("personal receipts are ingested even without an authored live flow and retain access ownership", async () => {
  for (const options of [{ personalOwner: "other" }, { live: false }]) {
    const app = setup({ ...options, contacts: [{ id: "contact", email: "buyer@example.com" }], messages: [message(1, "buyer@example.com")] });
    await app.run();
    assert.equal(app.tables.emails.length, 1);
    assert.equal(app.tables.emails[0].owner_id, options.personalOwner ?? "owner");
    assert.equal(app.tables.emails[0].body_loaded, false);
    assert.equal(app.bodyReads.length, 0);
  }
});
