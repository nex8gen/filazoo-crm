import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as rules from "../lib/email-followup.ts";
import * as threading from "../lib/email-threading.ts";
import { mergeAutoReplyHistory } from "../lib/email-auto-reply.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

type Row = Record<string, unknown>;
const source: InboxEmailItem = { id: "original", messageId: "<original@example.test>", direction: "inbound", timestamp: new Date(Date.now() - 3600_000).toISOString(), contact: "buyer@example.test", subject: "Quotation", body: "What is the MOQ?", preview: "", company: "Buyer", status: "Received" };
function setup() {
  const row: Row = { id: "followup", delivery_id: "delivery", user_id: "actor", mailbox_id: "mailbox", message_id: source.messageId, anchors: [source.messageId], baseline: [source.messageId], context_at: source.timestamp,
    kind: "ai", due_at: new Date(Date.now() - 1000).toISOString(), subject: "Re: Quotation", body: "Any questions?", status: "scheduled", revision: 1, updated_at: new Date().toISOString(), recipient: source.contact };
  const tables: Record<string, Row[]> = { email_message_followups: [row], email_send_operations: [], workspace_members: [{ user_id: "actor", role: "operator", activated_at: "2026-01-01", display_name: "Sales" }], suppression: [], contacts: [], email_auto_replies: [] };
  let messages = [source];
  let crmMessages: InboxEmailItem[] = [];
  let fresh = true, failure = false, paused = false, sends = 0;
  let beforeDelivery: (() => void) | undefined;
  let afterClaim: (() => void) | undefined;
  const db = { from(table: string) {
    let action = "select", values: Row = {}, one = false;
    const filters: Array<(row: Row) => boolean> = [];
    const query = {
      select() { return query; }, update(input: Row) { action = "update"; values = input; return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
      neq(key: string, value: unknown) { filters.push(row => row[key] !== value); return query; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
      lt(key: string, value: string) { filters.push(row => String(row[key]) < value); return query; },
      overlaps(key: string, value: string[]) { filters.push(row => (row[key] as string[]).some(item => value.includes(item))); return query; },
      order() { return query; }, limit() { return query; }, maybeSingle() { one = true; return query; }, single() { one = true; return query; },
      run() {
        const matches = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
        if (action === "update") for (const item of matches) Object.assign(item, values);
        if (action === "update" && values.status === "processing" && matches.length) afterClaim?.();
        return { data: one ? matches[0] || null : matches.map(row => ({ ...row })), error: null };
      },
      async throwOnError() { return query.run(); },
      then(resolve: (input: unknown) => unknown, reject: (input: unknown) => unknown) { return Promise.resolve(query.run()).then(resolve, reject); },
    };
    return query;
  } };
  const mailbox = { id: "mailbox", type: "personal", userId: "actor" };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../supabase/admin": { createSupabaseAdmin: () => db }, "../email-followup": rules,
    "./mailboxes": { getViewerMailbox: async () => paused ? null : mailbox, mailboxHasImap: () => true, mailboxHasSmtp: () => true },
    "./email-access": { getAssignedEmailContacts: async () => null }, "../email-access": { canViewEmail: () => true },
    "./email-auto-reply": { mailboxHistory: async () => ({ mailbox, messages }), hydrateAutoReplyHistory: async (_mailbox: unknown, messages: unknown) => messages },
    "../email-auto-reply": { mergeAutoReplyHistory }, "../email-threading": threading,
    "../email-inbox": { getEmailInboxBackendData: async () => ({ emails: crmMessages }) },
    "./mailbox-sync": { loadSyncedMailbox: async () => ({ messages, syncedAt: fresh ? new Date().toISOString() : new Date(Date.now() - 600_000).toISOString() }) },
    "./ai-settings": { requireAiFeature: async () => ({ actions: { sending: "ask" } }) },
    "../ai-policy": { aiBehaviorInstruction: () => "" },
    "../ai/provider-credentials": { resolveGatewayTokenAsync: async () => "test-token" },
    "../ai/gateway": { generateGatewayText: async () => "Hi, do you have any questions about the quotation?" },
    "./manual-email-send": { deliverEmail: async (_viewer: unknown, input: { requestId: string; inReplyTo?: string; references: string[] }, _reserved: boolean, gate: () => Promise<void>) => {
      assert.equal(input.requestId, row.delivery_id); assert.equal(input.inReplyTo, threading.referenceHeaderIds(String(row.message_id))[0]);
      assert.deepEqual([...input.references], threading.referenceHeaderIds(row.anchors as string[]));
      beforeDelivery?.();
      try { await gate(); }
      catch (error) { tables.email_send_operations.push({ id: row.delivery_id, user_id: "actor", status: "failed" }); return Response.json({ ok: false, error: String(error) }, { status: 500 }); }
      sends++;
      tables.email_send_operations.push({ id: row.delivery_id, user_id: "actor", status: failure ? "uncertain" : "sent" });
      return Response.json({ ok: !failure, error: failure ? "SMTP interrupted" : null }, { status: failure ? 500 : 200 });
    } },
  };
  const exports = {} as { processEmailFollowups: () => Promise<number>; followupContext: (viewer: unknown, mailboxId: string, messageId: string) => Promise<{ message: InboxEmailItem; anchors: string[]; recipient: string }>; saveFollowup: (viewer: unknown, input: unknown, baseline: string[]) => Promise<unknown>; previewFollowup: (viewer: unknown, mailboxId: string, messageId: string) => Promise<{ body: string; subject: string; baseline: string[] }> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-followups.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key]; }, Response, URLSearchParams, AbortSignal, process: { env: {} }, crypto, Date, console });
  const reply = (direction: "inbound" | "outbound" = "inbound") => { messages = [...messages, { ...source, id: "new", messageId: "<new@example.test>", inReplyTo: source.messageId, timestamp: new Date().toISOString(), direction }]; };
  return { row, tables, tick: exports.processEmailFollowups, context: (key: string) => exports.followupContext({ id: "actor", role: "operator" }, "mailbox", key), crm: (items: InboxEmailItem[]) => { crmMessages = items; }, sentOnly: () => { messages = [{ ...source, direction: "outbound" }]; }, save: () => exports.saveFollowup({ id: "actor", role: "operator" }, { action: "save", id: row.id, revision: row.revision, kind: "reminder", mailboxId: "mailbox", messageId: source.messageId, dueAt: new Date(Date.now() + 3600_000).toISOString(), subject: "Reminder", body: "" }, [source.messageId!]), preview: (key = source.messageId!) => exports.previewFollowup({ id: "actor", role: "operator" }, "mailbox", key), unload: () => { messages = [{ ...source, bodyLoaded: false, body: "" }]; }, reply, sends: () => sends, stale: () => { fresh = false; }, pause: () => { paused = true; }, fail: () => { failure = true; }, before: (action: () => void) => { beforeDelivery = action; }, claimed: (action: () => void) => { afterClaim = action; } };
}
test("a CRM inquiry without RFC metadata supports context loading, AI preview and reply cancellation", async () => {
  const app = setup();
  const inquiry = { ...source, id: "crm-inquiry", messageId: null, source: "crm" as const, threadId: "local:crm-inquiry" };
  app.crm([inquiry]);
  const context = await app.context(inquiry.id);
  assert.equal(context.message.id, inquiry.id); assert.equal(context.recipient, source.contact);
  const preview = await app.preview(inquiry.id); assert.match(preview.body, /quotation/);
  app.row.anchors = context.anchors; app.row.message_id = inquiry.id; app.row.baseline = [inquiry.id]; app.row.kind = "reminder";
  await app.tick(); assert.equal(app.row.status, "reminded");
  app.row.status = "scheduled";
  app.crm([inquiry, { ...source, id: "crm-sent", messageId: "<crm-sent@example.test>", direction: "outbound", status: "Sent", threadId: inquiry.threadId, timestamp: new Date().toISOString() }]);
  await app.tick(); assert.equal(app.row.status, "cancelled"); assert.equal(app.sends(), 0);
  await assert.rejects(app.context("another-users-unknown-record"), /unavailable/);
});
test("an unanswered sent email can be followed up before any customer has replied", async () => {
  const app = setup(); app.sentOnly();
  const context = await app.context(source.messageId!);
  assert.equal(context.recipient, source.contact);
  assert.match((await app.preview()).body, /quotation/);
});
test("CRM-only AI follow-ups send once without inventing an RFC reply header", async () => {
  const app = setup();
  const inquiry = { ...source, id: "crm-inquiry", messageId: null, source: "crm" as const, threadId: "local:crm-inquiry" };
  app.crm([inquiry]); const context = await app.context(inquiry.id);
  app.row.anchors = context.anchors; app.row.message_id = inquiry.id; app.row.baseline = [inquiry.id];
  await app.tick(); await app.tick();
  assert.equal(app.sends(), 1); assert.equal(app.row.status, "sent");
});
test("editing cannot reset the reply baseline after a customer answers in the open dialog", async () => {
  const app = setup(); app.reply();
  await assert.rejects(app.save(), /conversation changed while you reviewed/);
  assert.equal(app.row.revision, 1); assert.equal(app.row.status, "scheduled");
});
test("preview uses saved message bodies without opening IMAP or submitting email", async () => {
  const app = setup(); const result = await app.preview();
  assert.match(result.body, /quotation/); assert.equal(result.subject, "Re: Quotation");
  assert.deepEqual([...result.baseline], [source.messageId]); assert.equal(app.sends(), 0);
  app.unload(); await assert.rejects(app.preview(), /Load the latest message/);
});
test("concurrent scheduler ticks claim one follow-up and send exactly once", async () => {
  const app = setup(); await Promise.all([app.tick(), app.tick()]); await app.tick();
  assert.equal(app.sends(), 1); assert.equal(app.row.status, "sent");
});
test("a customer reply or newer team message cancels before the due time", async () => {
  for (const direction of ["inbound", "outbound"] as const) {
    const app = setup(); app.row.due_at = new Date(Date.now() + 86400_000).toISOString(); app.reply(direction);
    await app.tick(); assert.equal(app.row.status, "cancelled"); assert.equal(app.sends(), 0);
  }
});
test("stale mail sync holds the schedule without contacting SMTP", async () => {
  const app = setup(); app.stale(); await app.tick();
  assert.equal(app.row.status, "scheduled"); assert.match(String(app.row.error), /fresh mailbox sync/); assert.equal(app.sends(), 0);
});
test("a reply between claim and SMTP stops the actual send", async () => {
  const app = setup(); app.before(() => app.reply()); await app.tick();
  assert.equal(app.sends(), 0); assert.equal(app.row.status, "failed"); assert.match(String(app.row.error), /changed before delivery/);
});
test("cancellation winning a claim race prevents delivery", async () => {
  const app = setup(); app.row.status = "cancelled"; await app.tick(); assert.equal(app.sends(), 0);
});
test("revoked membership, disabled mailboxes and opted-out customers do not send", async () => {
  for (const reason of ["role", "mailbox", "optout", "suppressed"]) {
    const app = setup();
    if (reason === "role") app.tables.workspace_members[0].role = "viewer";
    if (reason === "mailbox") app.pause();
    if (reason === "optout") app.tables.contacts.push({ unsubscribed: true, email: source.contact });
    if (reason === "suppressed") app.tables.suppression.push({ email: source.contact });
    await app.tick(); assert.equal(app.row.status, "failed", reason); assert.equal(app.sends(), 0);
  }
});
test("reminders never submit email", async () => {
  const app = setup(); app.row.kind = "reminder"; await app.tick(); assert.equal(app.row.status, "reminded"); assert.equal(app.sends(), 0);
});
test("ambiguous SMTP failures and interrupted workers cannot be resent by later ticks", async () => {
  const app = setup(); app.fail(); await app.tick(); await app.tick(); assert.equal(app.row.status, "uncertain"); assert.equal(app.sends(), 1);
  for (const saved of [false, true]) {
    const interrupted = setup(); interrupted.row.status = "processing"; interrupted.row.updated_at = new Date(Date.now() - 700_000).toISOString();
    if (saved) interrupted.tables.email_send_operations.push({ id: "delivery", user_id: "actor", status: "sent" });
    await interrupted.tick(); assert.equal(interrupted.row.status, saved ? "sent" : "uncertain"); assert.equal(interrupted.sends(), 0);
  }
});
