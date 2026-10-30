import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { emailSendSchema } from "../lib/email-workbench.ts";
import * as threading from "../lib/email-threading.ts";
import * as content from "../lib/email-content.ts";
import { createHash } from "node:crypto";

type Row = Record<string, unknown>;
function setup() {
  const tables: Record<string, Row[]> = { email_send_operations: [], mailbox_sent_messages: [], workspace_members: [{ user_id: "actor", role: "operator", display_name: "Test user", activated_at: "2026-01-01T00:00:00Z" }] };
  const db = { from(table: string) {
    let action = "select", value: Row = {}, one = false;
    const filters: Array<[string, unknown]> = [];
    const ranges: Array<[string, string, boolean]> = [];
    const query = {
      insert(input: Row) { action = "insert"; value = input; return query; },
      update(input: Row) { action = "update"; value = input; return query; },
      eq(key: string, expected: unknown) { filters.push([key, expected]); return query; },
      lt(key: string, expected: string) { ranges.push([key, expected, false]); return query; },
      lte(key: string, expected: string) { ranges.push([key, expected, true]); return query; },
      order() { return query; }, limit() { return query; },
      select() { return query; }, single() { one = true; return query; }, maybeSingle() { one = true; return query; },
      run() {
        const rows = tables[table] ||= [];
        if (action === "insert") {
          if (rows.some((row) => row.id === value.id && row.user_id === value.user_id)) return { data: null, error: { code: "23505" } };
          rows.push({ ...value }); return { data: one ? { ...value } : [{ ...value }], error: null };
        }
        const matches = rows.filter((row) => filters.every(([key, expected]) => row[key] === expected) && ranges.every(([key, expected, equal]) => equal ? String(row[key]) <= expected : String(row[key]) < expected));
        if (action === "update") for (const row of matches) Object.assign(row, value);
        return { data: one ? matches[0] || null : matches, error: null };
      },
      async throwOnError() { const result = query.run(); if (result.error) throw result.error; return result; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(query.run()).then(resolve, reject); },
    };
    return query;
  } };
  let sends = 0;
  let failure = false;
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  let block = false;
  const dependencies: Record<string, unknown> = {
    "node:crypto": { createHash }, "../email-workbench": { emailSendSchema },
    "../supabase/admin": { createSupabaseAdmin: () => db },
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "actor", role: "operator" }) },
    "@/lib/data/mailboxes": { getViewerMailbox: async () => ({ id: "mailbox", email: "sender@example.test" }), mailboxHasSmtp: () => true },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => db },
    "@/lib/email-threading": threading, "@/lib/email-content": content,
    "@/lib/data/email-footers": { prepareUserEmail: async (_id: string, message: unknown) => message },
    "@/lib/mailer": { sendMailboxEmail: async (_config: unknown, message: { messageId: string }) => { sends++; entered?.(); if (block) await new Promise<void>((resolve) => { release = resolve; }); if (failure) throw new Error("Connection closed after DATA"); return { messageId: message.messageId }; } },
  };
  function load(path: string) {
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`); return dependencies[name]; }, Response, Request, Buffer, crypto, console });
    return exports as { deliverEmail: (viewer: { id: string; role: string }, input: unknown) => Promise<Response>; processScheduledEmails: (deliver: unknown) => Promise<number> };
  }
  const delivery = load("../lib/data/email-delivery.ts");
  dependencies["@/lib/data/email-delivery"] = delivery;
  const { deliverEmail } = load("../lib/data/manual-email-send.ts");
  const input = { to: "buyer@example.test", text: "Hello", subject: "Order", requestId: crypto.randomUUID() };
  const viewer = { id: "actor", role: "operator" };
  return { input, viewer, send: (message = input, actor = viewer) => deliverEmail(actor, message), process: () => delivery.processScheduledEmails(deliverEmail), tables, sends: () => sends, fail: () => { failure = true; }, block: () => { block = true; return new Promise<void>((resolve) => { entered = resolve; }); }, release: () => release?.() };
}

test("concurrent clicks and retries after a lost success response send exactly once", async () => {
  const mock = setup(); const entered = mock.block();
  const first = mock.send(); await entered;
  assert.equal((await mock.send()).status, 409);
  mock.release(); const response = await first;
  assert.equal(response.status, 200); const result = await response.json();
  const retry = await mock.send(); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), result);
  assert.equal(mock.sends(), 1); assert.equal(mock.tables.mailbox_sent_messages.length, 1);
});

test("an interrupted SMTP submission remains uncertain and cannot be automatically resent", async () => {
  const mock = setup(); mock.fail();
  assert.equal((await mock.send()).status, 500);
  assert.equal(mock.tables.email_send_operations[0].status, "uncertain");
  assert.equal((await mock.send()).status, 409); assert.equal(mock.sends(), 1);
});

test("reusing a request ID for changed content cannot corrupt a completed send", async () => {
  const mock = setup(); assert.equal((await mock.send()).status, 200);
  assert.equal((await mock.send({ ...mock.input, text: "Different message" })).status, 500);
  assert.equal(mock.tables.email_send_operations[0].status, "sent"); assert.equal(mock.sends(), 1);
});

test("scheduling reserves a delivery without contacting SMTP", async () => {
  const mock = setup();
  const response = await mock.send({ ...mock.input, scheduleAt: new Date(Date.now() + 3600_000).toISOString() } as typeof mock.input);
  assert.equal(response.status, 200); assert.equal((await response.json()).scheduled, true);
  assert.equal(mock.tables.email_send_operations[0].status, "scheduled"); assert.equal(mock.sends(), 0);
});

test("due scheduled mail reuses the manual delivery path and repeated ticks cannot resend it", async () => {
  const mock = setup();
  await mock.send({ ...mock.input, scheduleAt: new Date(Date.now() + 3600_000).toISOString() } as typeof mock.input);
  mock.tables.email_send_operations[0].scheduled_at = new Date(Date.now() - 1000).toISOString();
  assert.equal(await mock.process(), 1); assert.equal(mock.sends(), 1);
  assert.equal(mock.tables.email_send_operations[0].status, "sent");
  assert.equal(await mock.process(), 0); assert.equal(mock.sends(), 1);
});

test("a scheduled sender whose role is revoked fails before SMTP", async () => {
  const mock = setup();
  await mock.send({ ...mock.input, scheduleAt: new Date(Date.now() + 3600_000).toISOString() } as typeof mock.input);
  mock.tables.email_send_operations[0].scheduled_at = new Date(Date.now() - 1000).toISOString();
  mock.tables.workspace_members[0].role = "viewer";
  await mock.process(); assert.equal(mock.sends(), 0); assert.equal(mock.tables.email_send_operations[0].status, "failed");
});
