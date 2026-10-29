import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as engine from "../lib/flow-engine.ts";
import * as schema from "../lib/flow-email-test.ts";
import * as policy from "../lib/outreach-policy.ts";
import { blankStep } from "../lib/flows.ts";

type Row = Record<string, unknown>;
type Run = schema.FlowEmailDeliveryTestRun;
const require = createRequire(import.meta.url);
function load(file: string, dependencies: Record<string, unknown>, clock: typeof Date = Date) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? require(name), Date: clock, Response, Request, URL, Error, console });
  return exports;
}
const payload = () => schema.flowEmailDeliveryTestSchema.parse({ requestId: randomUUID(), recipient: "test-inbox@example.com", customerName: "Alex", companyName: "Test company",
  flow: { name: "Draft before activation", triggerType: "new_lead", triggerConfig: {}, status: "draft", steps: [
    { type: "wait", config: { amount: 2, unit: "minutes" } }, blankStep("ai_auto_reply"),
    { type: "if_condition", config: { field: "customer_replied", action: "stop_flow", unmatchedAction: "continue", lookbackDays: 7 } },
  ] }, firstMessage: true, emails: [{ from: "sample-customer@example.com", subject: "Catalog", body: "Please share your product catalog." }],
});

function fixture() {
  let now = Date.parse("2026-10-27T06:00:00Z");
  class Clock extends Date { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  const db: Record<string, Row[]> = {};
  const writes: string[] = [], uploads: string[] = [], mails: Row[] = [], generated: Row[] = [];
  let smtpFails = false;
  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let mode = "select", payload: Row = {}, single = false, head = false;
    const query = {
      select(_columns?: string, options?: { head?: boolean }) { head = Boolean(options?.head); return query; },
      eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query; },
      is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return query; },
      gt(key: string, value: string) { filters.push((row) => String(row[key]) > value); return query; },
      gte(key: string, value: string) { filters.push((row) => String(row[key]) >= value); return query; },
      insert(value: Row) { mode = "insert"; payload = value; return query; },
      update(value: Row) { mode = "update"; payload = value; return query; },
      single() { single = true; return query; }, maybeSingle() { single = true; return query; }, throwOnError() { return query; },
      then(resolve: (value: unknown) => unknown) {
        const rows = db[table] ??= [];
        let selected = rows.filter((row) => filters.every((filter) => filter(row)));
        if (mode === "insert") {
          if (rows.some((row) => row.id === payload.id)) return Promise.resolve({ error: { code: "23505" }, data: null }).then(resolve);
          selected = [{ created_at: new Clock().toISOString(), expires_at: new Clock(now + 7_200_000).toISOString(), result: [], status: "waiting", locked_at: null, current_action: 0, error: null, ...payload }];
          rows.push(...selected); writes.push(table);
        }
        if (mode === "update") { selected.forEach((row) => Object.assign(row, payload)); writes.push(table); }
        return Promise.resolve({ data: head ? null : structuredClone(single ? selected[0] ?? null : selected), count: selected.length, error: null }).then(resolve);
      },
    };
    return query;
  }
  const dependencies = {
    "./email-footers.ts": { getUserEmailFooter: async () => null, prepareUserEmail: async (_id: string, mail: unknown) => mail },
    "../email-footer.ts": { removeStandardSignoff: (text: string) => text },
    "../flow-email-test.ts": schema, "../flow-engine.ts": engine, "../outreach-policy.ts": policy,
    "../env.ts": { env: { DAILY_SEND_LIMIT: 20, BOUNCE_PAUSE_PERCENT: 3, dryRun: true, NEXT_PUBLIC_APP_URL: "https://crm.example.com", supabaseSecretKey: "test" } },
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from, storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null }; }, remove: async () => ({ error: null }) }) } }) },
    "./flow-runtime.ts": { emailTemplates: { welcome_intro: { subject: "Hi {{first_name}}", body: "Welcome {{first_name}}" } }, getFlowTestMailbox: async (userId: string, mailboxId: string) => mailboxId === "foreign" ? null : { id: "mailbox", email: "sales@example.com", smtpHost: "smtp.example.com", smtpUsername: userId, smtpPassword: "secret", smtpPort: 465 } },
    "./flow-ai-reply.ts": { hasFlowReplyProvider: () => true, loadFlowReplyProducts: async () => [], generateFlowAiReply: async (input: Row) => {
      generated.push(input); return { subject: "Re: Catalog", body: "The catalog is attached.", attachments: [{ filename: "catalog.pdf", content: Buffer.from("%PDF"), contentType: "application/pdf" }] };
    } },
    "../flow-tracking.ts": { buildFlowEmail: ({ body, config }: { body: string; config: Row }) => { assert.equal(config.trackOpens, false); return { text: body }; } },
    "../mailer.ts": { sendMailboxEmail: async (_mailbox: unknown, mail: Row) => { mails.push(mail); if (smtpFails) throw new Error("SMTP connection failed"); return { messageId: "<accepted@example.com>" }; } },
  };
  const service = load("../lib/data/flow-email-delivery-test.ts", dependencies, Clock);
  return { service, db, writes, mails, generated, uploads, advance: (ms: number) => { now += ms; }, failSmtp: () => { smtpFails = true; } };
}

test("real delivery waits two minutes, uses the explicit recipient, attaches the catalog, and records SMTP acceptance", async () => {
  const f = fixture(), input = payload();
  const start = await f.service.startFlowEmailDeliveryTest(input, "owner", "Manager") as Run;
  assert.equal(start.next_run_at, "2026-10-27T06:02:00.000Z");
  assert.equal((await f.service.processFlowEmailDeliveryTest(start.id, "owner") as Run).status, "waiting");
  f.advance(119_999);
  await f.service.processFlowEmailDeliveryTest(start.id, "owner");
  assert.equal(f.mails.length, 0); assert.equal(f.generated.length, 0);
  f.advance(1);
  const completed = await f.service.processFlowEmailDeliveryTest(start.id, "owner") as Run;
  assert.equal(completed.status, "completed");
  assert.equal(f.mails[0].to, input.recipient);
  assert.notEqual(f.mails[0].to, input.emails[0].from);
  assert.equal(f.mails[0].subject, "[Flow test] Re: Catalog");
  assert.equal((f.mails[0].attachments as Array<{ content: Buffer }>)[0].content.toString(), "%PDF");
  assert.equal(completed.result[0].messageId, "<accepted@example.com>");
  assert.equal(f.db.mailbox_sent_messages.length, 1);
  assert.ok(f.writes.every((table) => ["flow_email_test_runs", "mailbox_sent_messages"].includes(table)));
  assert.equal(f.uploads.length, 1);
});

test("duplicate starts, polling, and concurrent due requests cannot resend a test", async () => {
  const f = fixture(), input = payload();
  await Promise.all([f.service.startFlowEmailDeliveryTest(input, "owner", null), f.service.startFlowEmailDeliveryTest(input, "owner", null)]);
  assert.equal(f.db.flow_email_test_runs.length, 1);
  f.advance(120_000);
  await Promise.all([f.service.processFlowEmailDeliveryTest(input.requestId, "owner"), f.service.processFlowEmailDeliveryTest(input.requestId, "owner")]);
  await f.service.processFlowEmailDeliveryTest(input.requestId, "owner");
  assert.equal(f.mails.length, 1);
});

test("cancellation, foreign users, and unauthorized sender mailboxes do not send", async () => {
  const f = fixture(), input = payload();
  await f.service.startFlowEmailDeliveryTest(input, "owner", null);
  await assert.rejects(f.service.processFlowEmailDeliveryTest(input.requestId, "other"), /not found/);
  await assert.rejects(f.service.cancelFlowEmailDeliveryTest(input.requestId, "other"));
  await f.service.cancelFlowEmailDeliveryTest(input.requestId, "owner");
  f.advance(120_000);
  assert.equal((await f.service.processFlowEmailDeliveryTest(input.requestId, "owner") as Run).status, "cancelled");
  assert.equal(f.mails.length, 0);
  input.requestId = randomUUID(); input.flow.steps[1].config.mailboxId = "foreign";
  await assert.rejects(f.service.startFlowEmailDeliveryTest(input, "owner", null), /active mailbox/);
});

test("SMTP failures are terminal and suppressed or unsubscribed recipients remain blocked", async () => {
  for (const blocker of ["smtp", "suppression", "unsubscribe"]) {
    const f = fixture(), input = payload();
    if (blocker === "smtp") f.failSmtp();
    if (blocker === "suppression") f.db.suppression = [{ email: input.recipient }];
    if (blocker === "unsubscribe") f.db.contacts = [{ email: input.recipient, unsubscribed: true }];
    await f.service.startFlowEmailDeliveryTest(input, "owner", null); f.advance(120_000);
    const failed = await f.service.processFlowEmailDeliveryTest(input.requestId, "owner") as Run;
    assert.equal(failed.status, "failed"); assert.ok(failed.error);
    await f.service.processFlowEmailDeliveryTest(input.requestId, "owner");
    assert.equal(f.mails.length, blocker === "smtp" ? 1 : 0);
  }
});

test("test paths preserve skipped actions, reject excessive waits, and require one sample and a recipient", async () => {
  const f = fixture(), input = payload();
  input.flow.steps.unshift({ type: "if_condition", config: { field: "opened_email", action: "continue", unmatchedAction: "stop_flow", lookbackDays: 7 } });
  await assert.rejects(f.service.startFlowEmailDeliveryTest(input, "owner", null), /does not send/);
  input.flow.steps.shift(); input.flow.steps[0].config = { amount: 2, unit: "hours" };
  await assert.rejects(f.service.startFlowEmailDeliveryTest(input, "owner", null), /one hour/);
  assert.equal(schema.flowEmailDeliveryTestSchema.safeParse({ ...payload(), recipient: "" }).success, false);
  assert.equal(schema.flowEmailDeliveryTestSchema.safeParse({ ...payload(), emails: [payload().emails[0], payload().emails[0]] }).success, false);
});

test("real-send routes require membership, reject other origins and use only the signed-in user's runs", async () => {
  let role: string | null = null, calls = 0;
  const deps = {
    "@/lib/auth": { getWorkspaceViewer: async () => role ? { id: "signed-in", role, displayName: "Manager" } : null },
    "@/lib/flow-email-test": schema,
    "@/lib/data/flow-email-delivery-test": {
      startFlowEmailDeliveryTest: async (_input: unknown, userId: string) => { assert.equal(userId, "signed-in"); calls++; return {}; },
      processFlowEmailDeliveryTest: async (_id: string, userId: string) => { assert.equal(userId, "signed-in"); calls++; return {}; },
      loadFlowEmailDeliveryTest: async (_id: string, userId: string) => { assert.equal(userId, "signed-in"); return {}; },
    },
  };
  const start = load("../app/api/flows/test-email/send/route.ts", deps).POST;
  const tick = load("../app/api/flows/test-email/send/[id]/route.ts", deps).POST;
  const request = (origin = "https://crm.example.com") => new Request("https://crm.example.com/api/flows/test-email/send", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
  assert.equal((await start(request()) as Response).status, 401);
  role = "viewer"; assert.equal((await start(request()) as Response).status, 403);
  role = "operator"; assert.equal((await start(request("https://foreign.example")) as Response).status, 403);
  assert.equal(calls, 0);
  assert.equal((await start(request()) as Response).status, 200);
  const response = await tick(request(), { params: Promise.resolve({ id: randomUUID() }) }) as Response;
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls, 2);
});
