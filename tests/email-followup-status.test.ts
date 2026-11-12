import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { normalizeMessageId } from "../lib/email-threading.ts";

function service(options: { missingMailbox?: boolean; denyContact?: boolean; empty?: boolean } = {}) {
  const calls: string[] = [], filters: Record<string, unknown> = {};
  let projection = "";
  const row = { id: "followup", revision: 4, kind: "ai", status: "scheduled", due_at: "2026-11-12T10:00:00Z", subject: "Follow up", body: "Any questions?", error: null, task_id: null, recipient: "customer@example.test" };
  const query = {
    select(value: string) { projection = value; return query; },
    eq(key: string, value: unknown) { filters[key] = value; return query; },
    overlaps(_key: string, value: string[]) { filters.anchors = value; return query; },
    order() { return query; }, limit() { return query; }, maybeSingle() { return query; },
    async throwOnError() { calls.push("status"); return { data: options.empty ? null : row }; },
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../email-threading": { normalizeMessageId },
    "../supabase/admin": { createSupabaseAdmin: () => ({ from: (table: string) => { assert.equal(table, "email_message_followups"); return query; } }) },
    "./mailboxes": { getViewerMailboxes: async (userId: string, accessOnly: boolean) => { assert.equal(userId, "actor"); assert.equal(accessOnly, true); calls.push("mailbox-access"); return options.missingMailbox ? [] : [{ id: "team-mailbox", type: "workspace" }]; } },
    "./email-access": { getAssignedEmailContacts: async () => { calls.push("assignments"); return null; } },
    "../email-access": { canViewEmail: () => !options.denyContact },
  };
  const exports = {} as { readFollowupStatus: (viewer: unknown, mailboxId: string, messageId: string, anchors?: string[]) => Promise<Record<string, unknown> | null> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-followup-status.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { assert.ok(name in dependencies, `Status must not import mailbox history or AI: ${name}`); return dependencies[name]; } });
  return { read: () => exports.readFollowupStatus({ id: "actor", role: "operator" }, "team-mailbox", "crm-inquiry", ["<root@example.test>"]), calls, filters, projection: () => projection };
}
test("status uses a direct owner/mailbox-scoped query with no inbox, body or AI work", async () => {
  const app = service(); const result = await app.read();
  assert.equal(result?.revision, 4); assert.equal(result?.recipient, undefined);
  assert.equal(app.filters.user_id, "actor"); assert.equal(app.filters.mailbox_id, "team-mailbox");
  assert.ok((app.filters.anchors as string[]).includes("local:crm-inquiry"));
  assert.ok((app.filters.anchors as string[]).includes("<root@example.test>"));
  assert.notEqual(app.projection(), "*");
  assert.deepEqual(app.calls.sort(), ["assignments", "mailbox-access", "status"]);
});
test("the fast status read still rejects unavailable mailboxes and revoked contact access", async () => {
  await assert.rejects(service({ missingMailbox: true }).read(), /mailbox is unavailable/);
  await assert.rejects(service({ denyContact: true }).read(), /conversation is unavailable/);
  assert.equal(await service({ empty: true }).read(), null);
});
test("filter metadata paginates saved follow-up actions, enforces mailbox/owner scope and removes private fields", async () => {
  const pageReads: string[] = [];
  const followups = Array.from({ length: 501 }, (_, index) => ({ id: `followup-${index}`, kind: "reminder", status: "reminded", message_key: `message-${index}`, thread_key: `thread-${index}`, anchors: [`<${index}@example.test>`], updated_at: "2026-11-11T08:00:00Z", recipient: index === 500 ? "denied@example.test" : "allowed@example.test", task: { status: "done" } }));
  const automations = [{ id: "automation", status: "active", enabled: true, thread_key: "thread-ai", anchors: ["<ai@example.test>"], updated_at: "2026-11-11T08:00:00Z", recipient: "allowed@example.test" }];
  const db = { from(table: string) {
    let start = 0, end = 0;
    const filters: Record<string, unknown> = {};
    const query = {
      select(fields: string) { assert.ok(!fields.split(",").includes("body")); return query; },
      eq(key: string, value: unknown) { filters[key] = value; return query; }, order() { return query; },
      range(from: number, to: number) { start = from; end = to; return query; },
      async throwOnError() {
        assert.equal(filters.user_id, "actor"); assert.equal(filters.mailbox_id, "team"); pageReads.push(`${table}:${start}`);
        const rows = table === "email_message_followups" ? followups : automations;
        return { data: rows.slice(start, end + 1) };
      },
    };
    return query;
  } };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../email-threading": { normalizeMessageId },
    "../supabase/admin": { createSupabaseAdmin: () => db },
    "./mailboxes": { getViewerMailboxes: async () => [{ id: "team", type: "workspace" }] },
    "./email-access": { getAssignedEmailContacts: async () => null },
    "../email-access": { canViewEmail: (_viewer: unknown, recipient: string) => recipient !== "denied@example.test" },
  };
  const exports = {} as { listFollowupActions: (viewer: unknown, mailboxId: string) => Promise<Array<Record<string, unknown>>> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-followup-status.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  const result = await exports.listFollowupActions({ id: "actor", role: "operator" }, "team");
  assert.equal(result.length, 500); assert.equal(result[0].taskStatus, "done");
  assert.ok(result.every(row => row.source === "followup"));
  assert.ok(pageReads.every(page => !page.startsWith("email_auto_replies")), "Continuous auto-replies are a separate action");
  assert.ok(pageReads.includes("email_message_followups:500"));
  for (const row of result) { assert.equal(row.body, undefined); assert.equal(row.recipient, undefined); }
});
