import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as followups from "../lib/email-followup.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";
import { followupInstant, followupLocalTime } from "../lib/company-followup.ts";

const id = "d274723d-d3fd-490b-beb4-e3ee47c6fd13";
const now = Date.now();
function message(key: string, direction: "inbound" | "outbound" = "inbound", time = now): InboxEmailItem {
  return { id: key, messageId: `<${key}@example.com>`, direction, timestamp: new Date(time).toISOString(), contact: "customer@example.com", subject: "Quote", body: "Hello", preview: "Hello", company: "Example", status: "Received" };
}
test("follow-up scheduling rejects past, invalid, too-soon and distant dates", () => {
  for (const date of ["", "invalid", new Date(now).toISOString(), new Date(now + 30_000).toISOString(), new Date(now + 366 * 86400_000).toISOString()]) assert.throws(() => followups.validateFollowupTime(date, now));
  followups.validateFollowupTime(new Date(now + 60_000).toISOString(), now);
  const local = followupLocalTime(new Date(now + 3600_000).toISOString());
  assert.equal(followupLocalTime(followupInstant(local)), local);
});
test("only unseen messages at or after the reviewed conversation stop the follow-up", () => {
  const previous = message("previous");
  const baseline = [followups.followupMessageKey(previous)];
  assert.equal(followups.followupChanged([previous], baseline, previous.timestamp), false);
  assert.equal(followups.followupChanged([message("older", "inbound", now - 1000)], baseline, previous.timestamp), false);
  assert.equal(followups.followupChanged([message("reply", "inbound", now)], baseline, previous.timestamp), true);
  assert.equal(followups.followupChanged([message("manual", "outbound", now + 1)], baseline, previous.timestamp), true);
});
test("stale, missing, failed or implausible mailbox checks cannot authorize sending", () => {
  for (const snapshot of [{}, { syncedAt: "invalid" }, { syncedAt: new Date(now - 120_001).toISOString() }, { syncedAt: new Date(now + 61_000).toISOString() }, { syncedAt: new Date(now).toISOString(), error: "Sign in required" }]) assert.equal(followups.followupMailboxFresh(snapshot, now), false);
  assert.equal(followups.followupMailboxFresh({ syncedAt: new Date(now).toISOString() }, now), true);
});
test("AI follow-ups require reviewed content and normalize reply prefixes", () => {
  const valid = { action: "save", id, revision: 0, mailboxId: "mailbox", messageId: "<parent@example.com>", kind: "ai", dueAt: new Date(now + 3600_000).toISOString(), subject: "Follow up", body: "Any questions?" };
  assert.equal(followups.followupSaveSchema.safeParse(valid).success, true);
  assert.equal(followups.followupSaveSchema.safeParse({ ...valid, body: " " }).success, false);
  assert.equal(followups.followupSaveSchema.safeParse({ ...valid, messageId: "invalid\nheader" }).success, false);
  assert.equal(followups.followupSubject("Re: RE: Fw: Quote\r\nTest"), "Re: Quote  Test");
});
test("the contact panel resolves CRM-only messages and legacy sent rows instead of disabling both actions", () => {
  const inquiry = { ...message("crm-record"), messageId: null, mailboxId: null, source: "crm" as const };
  const sent = { ...message("legacy-sent", "outbound"), messageId: null, mailboxId: null };
  assert.deepEqual(followups.followupTarget([inquiry, sent], sent, "team-mailbox"), { mailboxId: "team-mailbox", messageId: "crm-record" });
  const canonical = { ...message("received"), mailboxId: "receiving-mailbox" };
  assert.deepEqual(followups.followupTarget([canonical, sent], sent, "team-mailbox"), { mailboxId: "receiving-mailbox", messageId: canonical.messageId });
  assert.deepEqual(followups.followupTarget([inquiry], inquiry, null, "default-sender"), { mailboxId: "default-sender", messageId: inquiry.id });
  assert.equal(followups.followupContextSchema.safeParse({ mailboxId: "mailbox", messageId: inquiry.id }).success, true);
});
test("CRM inquiry anchors track subsequent replies without joining unrelated subjects", () => {
  const inquiry = { ...message("crm-record"), messageId: null, threadId: "local:crm-record", source: "crm" as const };
  const sent = { ...message("sent", "outbound", now + 1), threadId: inquiry.threadId };
  const reply = { ...message("customer", "inbound", now + 2), inReplyTo: sent.messageId };
  const unrelated = { ...message("other"), subject: inquiry.subject };
  const anchors = followups.followupAnchors([inquiry]);
  const history = followups.followupConversation([unrelated, inquiry, sent, reply], anchors);
  assert.deepEqual(history.map(message => message.id), ["crm-record", "sent", "customer"]);
  assert.equal(followups.followupChanged(history, [inquiry.id], inquiry.timestamp), true);
});
function route() {
  let role = "admin";
  const calls: string[] = [];
  const dependencies: Record<string, unknown> = {
    zod: { z }, "@/lib/email-followup": followups,
    "@/lib/data/email-followup-status": { readFollowupStatus: async () => { calls.push("read"); return null; }, listFollowupActions: async () => { calls.push("list"); return []; } },
    "@/lib/auth": { getWorkspaceViewer: async () => { if (role === "unavailable") throw new Error("Workspace lookup timeout"); return role === "signed-out" ? null : { id, role }; } },
    "@/lib/workspace-context": { withWorkspaceViewer: (_viewer: unknown, work: () => unknown) => work() },
    "@/lib/data/email-followups": {
      readFollowup: async () => { calls.push("read"); return { row: null, context: { conversation: [message("original")] } }; }, presentFollowup: (row: unknown) => row,
      previewFollowup: async () => { calls.push("preview"); return { body: "Following up", subject: "Re: Quote" }; },
      saveFollowup: async () => { calls.push("save"); return { id, status: "scheduled" }; },
      cancelFollowup: async () => { calls.push("cancel"); return { id, status: "cancelled" }; },
    },
  };
  const exports = {} as { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/email/follow-up/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key]; }, Response, URL, performance });
  return { calls, get: exports.GET, setRole: (value: string) => { role = value; }, post: (input: unknown, origin = "http://localhost") => exports.POST(new Request("http://localhost/api/email/follow-up", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) })) };
}
test("reads and AI previews never schedule or send mail", async () => {
  const app = route();
  assert.equal((await app.get(new Request("http://localhost/api/email/follow-up?mailboxId=box&messageId=%3Cparent%40example.com%3E"))).status, 200);
  assert.equal((await app.post({ action: "preview", mailboxId: "box", messageId: "<parent@example.com>" })).status, 200);
  assert.deepEqual(app.calls, ["read", "preview"]);
});
test("mailbox filter metadata is read-only and requires a mailbox identity", async () => {
  const app = route();
  assert.equal((await app.get(new Request("http://localhost/api/email/follow-up?view=list"))).status, 400);
  const response = await app.get(new Request("http://localhost/api/email/follow-up?view=list&mailboxId=team"));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { actions: [] });
  assert.deepEqual(app.calls, ["list"]);
});
test("invalid input, cross-origin changes and viewers cannot schedule", async () => {
  const app = route();
  assert.equal((await app.post({ action: "cancel", id, revision: -1 })).status, 400);
  assert.equal((await app.post({ action: "cancel", id, revision: 1 }, "https://attacker.example")).status, 403);
  app.setRole("viewer");
  assert.equal((await app.post({ action: "cancel", id, revision: 1 })).status, 403);
  assert.deepEqual(app.calls, []);
});
test("long conversation status is a read-only POST available to viewers; auth failures remain JSON", async () => {
  const app = route(); app.setRole("viewer");
  const anchors = Array.from({ length: 100 }, (_, index) => `<${index}-${"x".repeat(200)}@example.test>`);
  assert.equal((await app.post({ action: "status", mailboxId: "box", messageId: "crm-record", anchors })).status, 200);
  assert.deepEqual(app.calls, ["read"]);
  app.setRole("signed-out");
  const expired = await app.get(new Request("http://localhost/api/email/follow-up?view=list&mailboxId=box"));
  assert.equal(expired.status, 401); assert.match((await expired.json()).error, /session has expired/);
  app.setRole("unavailable");
  const unavailable = await app.post({ action: "status", mailboxId: "box", messageId: "crm-record", anchors: [] });
  assert.equal(unavailable.status, 503); assert.match((await unavailable.json()).error, /workspace session/);
});
