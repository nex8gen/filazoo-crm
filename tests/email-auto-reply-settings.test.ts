import { policyTestDependency } from "./helpers/ai-policy.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../lib/email-auto-reply.ts";
import * as threading from "../lib/email-threading.ts";
import { canViewEmail } from "../lib/email-access.ts";

type Row = Record<string, unknown>;
function settings() {
  const viewer = { id: "user", role: "admin" };
  const message = { id: "inbound", messageId: "<customer@example.test>", direction: "inbound", contact: "buyer@example.test",
    timestamp: "2026-10-28T00:00:00Z", body: "", bodyLoaded: false, uid: 1, uidValidity: 1 };
  const rows: Record<string, Row[]> = { email_auto_replies: [], mailbox_sent_messages: [], contacts: [],
    workspace_members: [{ user_id: "user", role: "admin", activated_at: "2026-01-01" }] };
  let headerReads = 0, conflictOnce = false;
  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | null = null, inserted: Row | null = null, single = false;
    const query = {
      select: () => query, limit: () => query, order: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      not: (key: string, _op: string, value: unknown) => { filters.push((row) => row[key] !== value); return query; },
      overlaps: (key: string, values: unknown[]) => { filters.push((row) => (row[key] as unknown[]).some((value) => values.includes(value))); return query; },
      maybeSingle: () => { single = true; return query; }, single: () => { single = true; return query; },
      throwOnError: () => query, update: (value: Row) => { patch = value; return query; },
      insert: (value: Row) => { inserted = value; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        const tableRows = rows[table] ?? [];
        if (inserted) tableRows.push({ id: "automation", ...inserted });
        let matches = inserted ? [tableRows.at(-1)!] : tableRows.filter((row) => filters.every((filter) => filter(row)));
        if (patch && conflictOnce) { conflictOnce = false; tableRows[0].revision = Number(tableRows[0].revision) + 1; matches = []; }
        else if (patch) matches.forEach((row) => Object.assign(row, patch));
        return Promise.resolve({ data: JSON.parse(JSON.stringify(single ? matches[0] ?? null : matches)), error: null }).then(resolve);
      },
    };
    return query;
  }
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../supabase/admin": { createSupabaseAdmin: () => ({ from }) },
    "./mailboxes": { getViewerMailbox: async (_user: string, id: string) => id === "mailbox" ? { id, type: "personal", userId: "user" } : null,
      mailboxHasImap: () => true, mailboxHasSmtp: () => true },
    "./mailbox-sync": { loadSyncedMailbox: async (_mailbox: unknown, options: { sync: boolean; includeContent: boolean }) => {
      headerReads++; assert.equal(options.sync, false); assert.equal(options.includeContent, false);
      return { messages: [message], error: null };
    }, loadMailboxMessageContent: () => { throw new Error("Toggling must not download message bodies"); } },
    "./email-access": { getAssignedEmailContacts: async () => null }, "../email-access": { canViewEmail },
    "../email-auto-reply": model, "../email-threading": threading,
    "./flow-ai-reply": { hasFlowReplyProvider: () => true },
  };
  const exports = {} as {
    readAutoReplySetting: (viewer: unknown, mailboxId: string, ids: string[]) => Promise<Row | null>;
    enableAutoReply: (viewer: unknown, input: unknown) => Promise<Row>;
    stopAutoReply: (viewer: unknown, id: string) => Promise<Row>;
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-auto-reply.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => { const aiDependency = policyTestDependency(name); if (aiDependency) return aiDependency;  assert.ok(name in dependencies, name); return dependencies[name]; } });
  const enable = () => exports.enableAutoReply(viewer, { mailboxId: "mailbox", senderId: "mailbox", messageId: message.messageId, revision: 0 });
  return { exports, viewer, message, rows, enable, headerReads: () => headerReads, conflict: () => { conflictOnce = true; } };
}

test("opening the toggle reads saved settings without loading any mailbox history", async () => {
  const app = settings();
  assert.equal(await app.exports.readAutoReplySetting(app.viewer, "mailbox", [app.message.messageId]), null);
  assert.equal(app.headerReads(), 0);
  await assert.rejects(app.exports.readAutoReplySetting(app.viewer, "other-mailbox", [app.message.messageId]), /unavailable/);
});

test("enable persists from saved headers without syncing IMAP, downloading bodies or generating a reply", async () => {
  const app = settings();
  const row = await app.enable();
  assert.equal(row.enabled, true);
  assert.equal(row.status, "active");
  assert.equal(row.last_message_key, app.message.messageId);
  assert.equal(app.headerReads(), 1);
  const stored = await app.exports.readAutoReplySetting(app.viewer, "mailbox", [app.message.messageId]);
  assert.equal(stored?.enabled, true);
  assert.equal(app.headerReads(), 1);
});

test("turning off retries a simultaneous worker claim and persists Off", async () => {
  const app = settings();
  await app.enable(); app.conflict();
  const stopped = await app.exports.stopAutoReply(app.viewer, "automation");
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.status, "paused");
  assert.equal(app.rows.email_auto_replies[0].enabled, false);
});
