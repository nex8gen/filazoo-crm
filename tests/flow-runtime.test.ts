import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as engine from "../lib/flow-engine.ts";
import * as flows from "../lib/flows.ts";
import * as policy from "../lib/outreach-policy.ts";
import * as templates from "../lib/flow-templates.ts";
import * as tracking from "../lib/flow-tracking.ts";
import * as autoReply from "../lib/email-auto-reply.ts";
import * as attachmentUpload from "../lib/attachment-upload.ts";
import * as flowSmtp from "../lib/flow-smtp.ts";

type Row = Record<string, unknown>;
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-runtime.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute the real enrollment and email runtime against an in-memory database.
// SMTP is intercepted even when testing live-send mode.
function runtime(options: { businessWindow?: Date | null } = {}) {
  const contactId = randomUUID(), companyId = randomUUID(), flowId = randomUUID();
  const createdAt = new Date().toISOString();
  const db: Record<string, Row[]> = {
    contacts: [{ id: contactId, company_id: companyId, created_at: createdAt, name: "Test", email: "lead@example.com", verification_status: "valid", unsubscribed: false }],
    companies: [{ id: companyId, segment: "Shopify B2B lead", country: "US", status: "new" }],
    pipeline: [{ company_id: companyId, stage: "new", owner_id: "sales-owner" }],
    workspace_members: [{ user_id: "owner", activated_at: createdAt }, { user_id: "sales-owner", activated_at: createdAt }, { user_id: "specific-user", activated_at: createdAt }],
    flows: [{ id: flowId, user_id: "owner", status: "live", trigger_type: "new_lead", trigger_config: {}, lead_enrollment_started_at: new Date(Date.now() - 60_000).toISOString() }],
    flow_steps: [{ ...flows.blankStep("send_email"), id: randomUUID(), flow_id: flowId, position: 0, config: { ...flows.blankStep("send_email").config, templateId: "welcome_intro", sendWindow: "anytime" } }],
    workspace_mailboxes: [{ id: "sender", type: "workspace", is_default: true, is_active: true, email: "sales@example.com", smtpHost: "smtp.example.com", smtpPort: 465, smtpUsername: "sales", smtpPassword: "test" }],
  };
  let delivered = 0;
  const deliveries: Array<{ mailbox: Row; mail: Row }> = [];
  const aiCalls: Row[] = [];
  const valueAt = (row: Row, key: string) => key.includes("->>") ? (row[key.split("->>")[0]] as Row)?.[key.split("->>")[1]] : row[key];
  const env = { DAILY_SEND_LIMIT: 20, BOUNCE_PAUSE_PERCENT: 3, dryRun: false, NEXT_PUBLIC_APP_URL: "https://crm.example.com", supabaseSecretKey: "test" };
  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let operation = "select", payload: Row | Row[] = {}, single = false, head = false;
    let conflict = "id", maximum = Infinity;
    const order: Array<{ key: string; ascending: boolean }> = [];
    let range: [number, number] | null = null;
    const query = {
      select(_columns?: string, options?: { head?: boolean }) { head = options?.head ?? false; return query; },
      eq(key: string, value: unknown) { filters.push((row) => valueAt(row, key) === value); return query; },
      is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return query; },
      lte(key: string, value: string) { filters.push((row) => row[key] != null && String(row[key]) <= value); return query; },
      lt(key: string, value: string) { filters.push((row) => row[key] != null && String(row[key]) < value); return query; },
      gt(key: string, value: string) { filters.push((row) => String(row[key]) > value); return query; },
      gte(key: string, value: string) { filters.push((row) => String(row[key]) >= value); return query; },
      in(key: string, values: unknown[]) { filters.push((row) => values.includes(valueAt(row, key))); return query; },
      not(key: string, _operator: string, value: unknown) { filters.push((row) => (row[key] ?? null) !== value); return query; },
      or(expression: string) { filters.push(row => expression.split(",").some(part => {
        const [, key, op, value] = /^([^.]+)\.(is|eq|lte|lt)\.(.*)$/.exec(part) ?? [];
        if (op === "is") return (row[key] ?? null) === (value === "null" ? null : value);
        if (op === "eq") return row[key] === value;
        return row[key] != null && (op === "lt" ? String(row[key]) < value : String(row[key]) <= value);
      })); return query; },
      order(key: string, options?: { ascending?: boolean }) { order.push({ key, ascending: options?.ascending !== false }); return query; },
      limit(value: number) { maximum = value; return query; },
      range(from: number, to: number) { range = [from, to]; return query; },
      insert(value: Row | Row[]) { operation = "insert"; payload = value; return query; },
      upsert(value: Row, options: { onConflict: string }) { operation = "upsert"; payload = value; conflict = options.onConflict; return query; },
      update(value: Row) { operation = "update"; payload = value; return query; },
      single() { single = true; return query; }, maybeSingle() { single = true; return query; }, throwOnError() { return query; },
      then(resolve: (result: unknown) => unknown) {
        const rows = db[table] ??= [];
        let selected = rows.filter((row) => filters.every((filter) => filter(row)));
        selected.sort((a, b) => { for (const { key, ascending } of order) { const result = String(a[key] ?? "").localeCompare(String(b[key] ?? "")); if (result) return ascending ? result : -result; } return 0; });
        if (range) selected = selected.slice(range[0], range[1] + 1);
        selected = selected.slice(0, maximum);
        if (operation === "insert") {
          const inputs = Array.isArray(payload) ? payload : [payload];
          if (table === "flow_runs" && inputs.some((input) => rows.some((row) => row.flow_id === input.flow_id && row.event_key === input.event_key))) {
            return Promise.resolve({ data: null, error: { code: "23505" } }).then(resolve);
          }
          selected = inputs.map((input) => ({ id: randomUUID(), created_at: new Date().toISOString(), started_at: new Date().toISOString(), locked_at: null, ...input }));
          rows.push(...selected);
        } else if (operation === "update") selected.forEach((row) => Object.assign(row, payload));
        else if (operation === "upsert") {
          const input = payload as Row;
          const existing = rows.find(row => conflict.split(",").every(key => row[key] === input[key]));
          if (existing) Object.assign(existing, input);
          else rows.push({ id: randomUUID(), ...input });
        }
        return Promise.resolve({ data: head ? null : single ? selected[0] ?? null : selected, count: selected.length, error: null }).then(resolve);
      },
    };
    return query;
  }
  const dependencies: Record<string, unknown> = {
    "../attachment-upload.ts": attachmentUpload,
    "../flow-smtp.ts": flowSmtp,
    "./email-footers.ts": { getUserEmailFooter: async () => null, prepareUserEmail: async (_userId: string, input: unknown) => input },
    "../email-footer.ts": { removeStandardSignoff: (text: string) => text },
    "../email-auto-reply.ts": autoReply,
    "server-only": {}, "../auth.ts": { requireWorkspaceMember: async () => ({ id: "owner" }) },
    "../flow-engine.ts": { ...engine, ...(Object.hasOwn(options, "businessWindow") ? { nextBusinessWindow: () => options.businessWindow } : {}) }, "../flows.ts": flows, "../outreach-policy.ts": policy, "../flow-templates.ts": templates,
    "../env.ts": { env },
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({
      from,
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.com` } } }) } },
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
    }) },
    "../mailbox-utils.ts": { normalizeMailboxRow: (row: unknown) => row },
    "../flow-tracking.ts": tracking,
    "./email-footers.ts": { getUserEmailFooter: async () => null, prepareUserEmail: async (_id: string, mail: unknown) => mail },
    "../email-footer.ts": { removeStandardSignoff: (text: string) => text },
    "../mailer.ts": { sendMailboxEmail: async (mailbox: Row, mail: Row) => { delivered++; deliveries.push({ mailbox, mail }); return { messageId: `<test-${delivered}@example.com>` }; } },
    "./flow-mail-sync.ts": { syncFlowMailboxMessages: async () => { throw new Error("Resume worker must not wait for IMAP"); } },
    "./flow-ai-reply.ts": { hasFlowReplyProvider: () => true, prepareFlowAiReply: async (input: Row) => { aiCalls.push(input); return { subject: "AI reply", body: "Synthetic provider reply", attachments: [] }; }, prepareFlowTemplateCatalog: async () => [{ filename: "Filazoo-product-catalog.pdf", content: Buffer.from("test catalog"), contentType: "application/pdf" }] },
  };
  const exports = {} as {
    enrollNewLeadFlows: (id: string) => Promise<Array<{ enrolled: boolean; reason: string }>>;
    enrollMatchingFlows: (event: engine.TriggerEvent) => Promise<Array<{ enrolled: boolean; reason: string }>>;
    processFlowRun: (id: string) => Promise<{ status: string }>;
    processDueFlowRuns: (limit: number, options: { syncMailbox: boolean }) => Promise<unknown[]>;
    scanTimeBasedFlowTriggers: (id?: string) => Promise<number>;
  };
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Date, console });
  return { db, env, contactId, companyId, flowId, exports, deliveries, aiCalls, delivered: () => delivered };
}

test("a saved new lead immediately executes email and scanner retries cannot send twice", async () => {
  const app = runtime();
  assert.equal((await app.exports.enrollNewLeadFlows(app.contactId))[0]?.reason, "done", JSON.stringify(app.db.flow_run_logs));
  assert.equal(app.delivered(), 1);
  assert.equal(app.db.emails.length, 1);
  assert.equal(app.db.mailbox_sent_messages.length, 1);
  assert.equal(app.db.flow_runs[0].event_key, `new_lead:${app.contactId}`);
  assert.equal(app.db.flow_runs[0].conversation_id, `company:${app.companyId}:lead:${app.contactId}`);
  const retry = await app.exports.enrollMatchingFlows({ type: "new_lead", contactId: app.contactId, conversationId: "different", eventKey: "different" });
  assert.equal(retry[0]?.enrolled, false);
  assert.equal(app.delivered(), 1);
});

test("queued legacy sales actions cancel before sending or changing account data", async () => {
  const app = runtime();
  const mail = app.db.flow_steps[0];
  steps(app, [{ type: "wait", config: { amount: 1, unit: "minutes" } }, { type: "send_email", config: mail.config }]);
  await app.exports.enrollNewLeadFlows(app.contactId);
  const run = app.db.flow_runs[0];
  const context = run.context as Record<string, unknown>;
  const definition = JSON.parse(String(context.definition));
  definition[1] = { ...definition[1], type: "update_company", config: { pipelineStage: "won" } };
  context.definition = JSON.stringify(definition);
  run.next_run_at = new Date(Date.now() - 1).toISOString();
  assert.equal((await app.exports.processFlowRun(String(run.id))).status, "cancelled");
  assert.equal(app.delivered(), 0);
  assert.equal(app.db.pipeline[0].stage, "new");
});

test("nested live branches resume from waits, reread CRM changes and execute every action once", async () => {
  for (const country of ["US", "GB"]) {
    const app = runtime();
    app.db.companies[0].country = country;
    const makeSplit = (id: string, condition: Row, yes: Row[], no: Row[]) => ({ id, type: "split", config: { name: id, paths: [
      { id: `${id}-yes`, name: "Match", condition, steps: yes }, { id: `${id}-no`, name: "Everyone else", condition: null, steps: no },
    ] } });
    const mail = app.db.flow_steps[0];
    const inner = makeSplit("inner", { field: "company_status_is", companyStatus: "qualified" }, [
      { ...flows.blankStep("ai_auto_reply"), id: "ai" },
      { ...flows.blankStep("create_task"), id: "task" },
      { ...flows.blankStep("internal_alert"), id: "alert" },
    ], [{ ...flows.blankStep("stop"), id: "unexpected-stop" }]);
    const outer = makeSplit("outer", { field: "country_is", value: "US" }, [
      { ...flows.blankStep("wait"), id: "wait", config: { amount: 1, unit: "minutes" } }, inner,
    ], [{ ...mail, id: "fallback-email" }]);
    app.db.flow_steps = [{ ...outer, flow_id: app.flowId, position: 0 },
      { ...flows.blankStep("change_category"), id: "category", flow_id: app.flowId, position: 1 },
      { ...flows.blankStep("update_company"), id: "company", config: { companyStatus: "qualified", segment: "Qualified" }, flow_id: app.flowId, position: 2 },
      { ...flows.blankStep("stop"), id: "end", flow_id: app.flowId, position: 3 }];
    const first = await app.exports.enrollNewLeadFlows(app.contactId);
    if (country === "US") {
      assert.equal(first[0]?.reason, "waiting");
      app.db.companies[0].status = "qualified";
      app.db.flow_runs[0].next_run_at = new Date(Date.now() - 1).toISOString();
      assert.equal((await app.exports.processFlowRun(String(app.db.flow_runs[0].id))).status, "done");
      assert.equal(app.aiCalls.length, 1);
      assert.equal(app.db.crm_tasks.length, 1);
      assert.equal(app.db.internal_notifications.length, 1);
    } else {
      assert.equal(first[0]?.reason, "done");
      assert.equal(app.aiCalls.length, 0);
      assert.equal(app.db.crm_tasks?.length ?? 0, 0);
    }
    assert.equal(app.db.pipeline[0].stage, "new", "account follow-ups must not mutate retired stages");
    assert.equal(app.db.companies[0].segment, "Qualified");
    assert.equal(app.db.email_inbox_state[0].category, "Needs follow-up");
    const logs = app.db.flow_run_logs.length;
    await app.exports.processFlowRun(String(app.db.flow_runs[0].id));
    assert.equal(app.db.flow_run_logs.length, logs);
    assert.equal(app.delivered(), 1);
  }
});

test("a live split expands only the first matching path and executes its saved actions", async () => {
  const app = runtime();
  const splitId = randomUUID();
  app.db.flow_steps = [{ id: splitId, flow_id: app.flowId, position: 0, type: "split", config: {
    name: "Qualification",
    paths: [
      { id: "qualified", name: "Qualified", condition: { field: "fit_score_at_least", fitScore: 7, lookbackDays: 7 }, steps: [{ id: "qualified-task", type: "create_task", config: flows.blankStep("create_task").config }] },
      { id: "otherwise", name: "Everyone else", condition: null, steps: [{ id: "fallback-email", type: "send_email", config: { ...flows.blankStep("send_email").config, templateId: "welcome_intro", sendWindow: "anytime" } }] },
    ],
  } }];
  const result = await app.exports.enrollNewLeadFlows(app.contactId);
  assert.equal(result[0]?.reason, "done", JSON.stringify(app.db.flow_run_logs));
  assert.equal(app.delivered(), 1);
  assert.equal(app.db.crm_tasks?.length ?? 0, 0);
  assert.equal((app.db.flow_run_logs.find((log) => (log.result as Row)?.action === "split_evaluated")?.result as Row)?.pathId, "otherwise");
  assert.ok(String((app.db.flow_runs[0].context as Row).definition).includes("send_email"));
});

test("trigger re-entry rules block repeat customers or enforce a cooldown", async () => {
  for (const mode of ["no_reentry", "after_period"] as const) {
    const app = runtime();
    Object.assign(app.db.flows[0], { trigger_type: "category_changed", trigger_config: { category: "Interested", reentryMode: mode, ...(mode === "after_period" ? { reentryAfterAmount: 30, reentryAfterUnit: "days" } : {}) } });
    const event = { type: "category_changed" as const, contactId: app.contactId, companyId: app.companyId, conversationId: `company:${app.companyId}`, category: "Interested" };
    assert.equal((await app.exports.enrollMatchingFlows({ ...event, eventKey: `${mode}-first` }))[0]?.enrolled, true);
    const repeat = await app.exports.enrollMatchingFlows({ ...event, eventKey: `${mode}-second` });
    assert.equal(repeat[0]?.enrolled, false);
    assert.match(String(repeat[0]?.reason), mode === "no_reentry" ? /already entered/ : /waiting period/);
    assert.equal(app.delivered(), 1);
  }
});

test("send-time profile filters, message filters and Smart Sending skip one email while later CRM actions continue", async () => {
  for (const reason of ["profile", "message", "frequency"]) {
    const app = runtime();
    const email = app.db.flow_steps[0];
    if (reason === "profile") app.db.flows[0].trigger_config = { companyStatus: "new" };
    if (reason === "message") (email.config as Row).filters = { field: "country_is", value: "GB" };
    if (reason === "frequency") {
      (email.config as Row).smartSendingHours = 16;
      app.db.mailbox_sent_messages = [{ user_id: "owner", to_email: "lead@example.com", sent_at: new Date().toISOString() }];
    }
    app.db.flow_steps = [{ ...flows.blankStep("wait"), id: randomUUID(), flow_id: app.flowId, position: 0 }, { ...email, position: 1 }, { ...flows.blankStep("create_task"), id: randomUUID(), flow_id: app.flowId, position: 2 }];
    assert.equal((await app.exports.enrollNewLeadFlows(app.contactId))[0]?.reason, "waiting");
    if (reason === "profile") app.db.companies[0].status = "engaged";
    const run = app.db.flow_runs[0]; run.next_run_at = new Date(Date.now() - 1).toISOString();
    assert.equal((await app.exports.processFlowRun(String(run.id))).status, "done");
    assert.equal(app.delivered(), 0);
    assert.equal(app.db.crm_tasks.length, 1);
    assert.ok(app.db.flow_run_logs.some((row) => (row.result as Row)?.action === "email_skipped"));
  }
});

test("individual email/company automations send only to eligible contacts and preserve wait/pause/resume", async () => {
  for (const flowScope of ["email", "company"]) {
    const app = runtime();
    const sibling = { ...app.db.contacts[0], id: randomUUID(), email: "sibling@example.com" };
    const outsider = { ...app.db.contacts[0], id: randomUUID(), company_id: randomUUID(), email: "outsider@example.com" };
    app.db.contacts.push(sibling, outsider);
    Object.assign(app.db.flows[0], { trigger_type: "email_received", email_enrollment_started_at: new Date(Date.now() - 60_000).toISOString(), trigger_config: { flowScope, scopeCompanyId: app.companyId, ...(flowScope === "email" ? { scopeContactId: app.contactId } : {}) } });
    app.db.flow_steps = [{ id: randomUUID(), flow_id: app.flowId, position: 0, type: "wait", config: { amount: 1, unit: "minutes" } }, ...app.db.flow_steps.map((step) => ({ ...step, position: 1 }))];
    for (const contact of app.db.contacts) {
      await app.exports.enrollMatchingFlows({ type: "email_received", contactId: String(contact.id), conversationId: String(contact.id), occurredAt: new Date().toISOString(), eventKey: String(contact.id) });
    }
    assert.equal(app.db.flow_runs.length, flowScope === "email" ? 1 : 2);
    assert.equal(app.delivered(), 0);
    app.db.flows[0].status = "paused";
    for (const run of app.db.flow_runs) {
      run.next_run_at = new Date(Date.now() - 1).toISOString();
      assert.equal((await app.exports.processFlowRun(String(run.id))).status, "paused");
    }
    app.db.flows[0].status = "live";
    for (const run of app.db.flow_runs) {
      assert.equal((await app.exports.processFlowRun(String(run.id))).status, "done");
      await app.exports.processFlowRun(String(run.id));
    }
    assert.equal(app.delivered(), flowScope === "email" ? 1 : 2);
    assert.ok(app.deliveries.every(({ mail }) => mail.to !== "outsider@example.com"));
  }
});

test("a company contact moved during a wait cannot receive queued actions", async () => {
  for (const type of ["send_email", "ai_auto_reply", "create_task"] as const) {
    const app = runtime();
    app.db.flows[0].trigger_config = { flowScope: "company", scopeCompanyId: app.companyId };
    app.db.flow_steps = [{ id: randomUUID(), flow_id: app.flowId, position: 0, type: "wait", config: { amount: 1, unit: "minutes" } }, { ...flows.blankStep(type), id: randomUUID(), flow_id: app.flowId, position: 1, config: type === "send_email" ? app.db.flow_steps[0].config : flows.blankStep(type).config }];
    await app.exports.enrollNewLeadFlows(app.contactId);
    app.db.contacts[0].company_id = randomUUID();
    app.db.flow_runs[0].next_run_at = new Date(Date.now() - 1).toISOString();
    assert.equal((await app.exports.processFlowRun(String(app.db.flow_runs[0].id))).status, "cancelled");
    assert.equal(app.delivered(), 0);
    assert.equal(app.aiCalls.length, 0);
    assert.equal(app.db.crm_tasks?.length ?? 0, 0);
  }
});

test("company segment changes enroll the email flow's contact even when another contact represents the company", async () => {
  for (const type of ["company_segment_changed"] as const) {
    const app = runtime();
    const representativeId = randomUUID();
    app.db.contacts.push({ ...app.db.contacts[0], id: representativeId, email: "representative@example.com" });
    Object.assign(app.db.flows[0], { trigger_type: type, trigger_config: { flowScope: "email", scopeCompanyId: app.companyId, scopeContactId: app.contactId, ...(type === "company_segment_changed" ? { segment: "Shopify B2B lead" } : { stage: "new" }) } });
    const result = await app.exports.enrollMatchingFlows({ type, contactId: representativeId, companyId: app.companyId, conversationId: `company:${app.companyId}`, segment: "Shopify B2B lead", stage: "new" });
    assert.equal(result[0].enrolled, true);
    assert.equal(app.db.flow_runs[0].contact_id, app.contactId);
    assert.equal(app.delivered(), 1);
    assert.equal(app.deliveries[0].mail.to, "lead@example.com");
  }
});

test("selected customers receive flow emails while other contacts at the same company do not enroll", async () => {
  const app = runtime();
  const otherId = randomUUID();
  app.db.contacts.push({ ...app.db.contacts[0], id: otherId, email: "other@example.com" });
  app.db.flows[0].trigger_config = { contactIds: [app.contactId] };
  const excluded = await app.exports.enrollNewLeadFlows(otherId);
  assert.equal(excluded[0]?.enrolled, false);
  assert.equal(app.delivered(), 0);
  await app.exports.enrollNewLeadFlows(app.contactId);
  assert.equal(app.delivered(), 1);
  assert.equal(app.deliveries[0].mail.to, "lead@example.com");
});

test("multiple selected customers each receive their own flow email", async () => {
  const app = runtime();
  const otherId = randomUUID();
  app.db.contacts.push({ ...app.db.contacts[0], id: otherId, email: "other@example.com" });
  app.db.flows[0].trigger_config = { contactIds: [app.contactId, otherId] };
  await app.exports.enrollNewLeadFlows(app.contactId);
  await app.exports.enrollNewLeadFlows(otherId);
  assert.equal(app.delivered(), 2);
  assert.deepEqual(app.deliveries.map((delivery) => delivery.mail.to).sort(), ["lead@example.com", "other@example.com"]);
});

test("removing a selected customer cancels their waiting email for both email action types", async () => {
  for (const type of ["send_email", "ai_auto_reply"] as const) {
    const app = runtime();
    const config = type === "send_email" ? { ...app.db.flow_steps[0].config as flows.JsonConfig } : { ...flows.blankStep(type).config };
    steps(app, [{ type: "wait", config: { amount: 1, unit: "hours" } }, { type, config }]);
    app.db.flows[0].trigger_config = { contactIds: [app.contactId] };
    await app.exports.enrollNewLeadFlows(app.contactId);
    assert.equal(app.db.flow_runs[0].status, "active");
    app.db.flows[0].trigger_config = { contactIds: [randomUUID()] };
    app.db.flow_runs[0].next_run_at = null;
    const result = await app.exports.processFlowRun(String(app.db.flow_runs[0].id));
    assert.equal(result.status, "cancelled");
    assert.equal(app.delivered(), 0);
    assert.equal(app.aiCalls.length, 0);
    assert.match(JSON.stringify(app.db.flow_run_logs), /no longer selected/);
  }
});

function steps(app: ReturnType<typeof runtime>, definitions: Array<{ type: flows.FlowStepType; config: flows.JsonConfig }>) {
  app.db.flow_steps = definitions.map((step, position) => ({ id: randomUUID(), flow_id: app.flowId, position, ...step }));
}

test("all email templates render real content; catalog template uploads and attaches a PDF", async () => {
  for (const templateId of Object.keys(templates.emailTemplates)) {
    const app = runtime();
    Object.assign(app.db.flow_steps[0].config as Row, { templateId });
    assert.equal((await app.exports.enrollNewLeadFlows(app.contactId))[0]?.reason, "done");
    assert.equal(app.deliveries.length, 1);
    assert.match(String(app.deliveries[0].mail.text), /Hi Test/);
    assert.equal((app.deliveries[0].mail.attachments as unknown[]).length, templateId === "send_catalog" ? 1 : 0);
    assert.equal((app.db.mailbox_sent_messages[0].attachments as unknown[]).length, templateId === "send_catalog" ? 1 : 0);
  }
});

test("custom subject, body, preheader and tracking toggles reach the delivered email", async () => {
  for (const enabled of [true, false]) {
    const app = runtime();
    Object.assign(app.db.flow_steps[0].config as Row, { subject: "Hello {{first_name}}", body: "Dear {{first_name}} https://filazoo.com/catalog", preheader: "Preview", trackOpens: enabled, trackClicks: enabled, utmTracking: enabled });
    await app.exports.enrollNewLeadFlows(app.contactId);
    const mail = app.deliveries[0].mail;
    assert.equal(mail.subject, "Hello Test");
    assert.match(String(mail.html), /Preview/);
    assert.equal(String(mail.html).includes("<img"), enabled);
    assert.equal(String(mail.text).includes("/api/flows/track"), enabled);
  }
});

test("template emails, AI replies and email alerts send using their selected personal or team account", async () => {
  for (const type of ["send_email", "ai_auto_reply", "internal_alert"] as const) {
    for (const [choice, expected] of [["default", "sales@example.com"], ["owner", "personal@example.com"], ["personal", "personal@example.com"], ["explicit", "specific@example.com"]]) {
      const app = runtime();
      app.db.workspace_mailboxes.push({ ...app.db.workspace_mailboxes[0], id: "personal", type: "personal", user_id: "owner", email: "personal@example.com", smtpUsername: "personal-login" }, { ...app.db.workspace_mailboxes[0], id: "explicit", is_default: false, email: "specific@example.com", smtpUsername: "team-login" });
      steps(app, [{ type, config: { ...flows.blankStep(type).config, templateId: "welcome_intro", sendWindow: "anytime", mailboxId: choice, channel: "email" } }]);
      await app.exports.enrollNewLeadFlows(app.contactId);
      assert.equal(app.deliveries[0].mailbox.from, expected);
      assert.equal(app.deliveries[0].mailbox.user, choice === "default" ? "sales" : choice === "explicit" ? "team-login" : "personal-login");
      if (type !== "internal_alert") assert.equal(app.db.mailbox_sent_messages[0].mailbox_id, choice === "owner" ? "personal" : choice === "default" ? "sender" : choice);
    }
  }
});

test("unavailable or another user's personal sender never falls back to team email", async () => {
  for (const type of ["send_email", "ai_auto_reply", "internal_alert"] as const) {
    for (const choice of ["owner", "private", "stopped", "removed"]) {
      const app = runtime();
      app.db.workspace_mailboxes.push(
        { ...app.db.workspace_mailboxes[0], id: "private", type: "personal", user_id: "someone-else", email: "private@example.com" },
        { ...app.db.workspace_mailboxes[0], id: "stopped", is_active: false },
      );
      steps(app, [{ type, config: { ...flows.blankStep(type).config, templateId: "welcome_intro", sendWindow: "anytime", mailboxId: choice, channel: "email" } }]);
      await app.exports.enrollNewLeadFlows(app.contactId);
      assert.equal(app.deliveries.length, 0, `${type}: ${choice}`);
      assert.equal(app.db.flow_runs[0].status, "failed");
    }
  }
});

test("thread option preserves reply headers or creates a separate stored conversation", async () => {
  for (const replyInThread of [true, false]) {
    const app = runtime();
    const thread = `company:${app.companyId}:lead:${app.contactId}`;
    app.db.emails = [{ id: "original", contact_id: app.contactId, thread_id: thread, message_id: "<customer@example.com>", direction: "received", created_at: new Date(Date.now() - 1000).toISOString() }];
    (app.db.flow_steps[0].config as Row).replyInThread = replyInThread;
    await app.exports.enrollNewLeadFlows(app.contactId);
    assert.equal(app.deliveries[0].mail.inReplyTo, replyInThread ? "<customer@example.com>" : undefined);
    assert.equal(app.db.mailbox_sent_messages[0].thread_key === thread, replyInThread);
  }
});

test("CRM task assignment, due date, notes, priority, alerts and stop outcomes persist", async () => {
  const app = runtime();
  steps(app, [
    { type: "create_task", config: { assigneeType: "owner", title: "Call", dueInDays: 2, priority: "high", notes: "Customer requested contact" } },
    { type: "create_task", config: { assigneeType: "user", assigneeId: "specific-user", title: "Review", dueInDays: 0, priority: "low" } },
    { type: "internal_alert", config: { userId: "owner", message: "Owner alert", channel: "in_app", includeThreadLink: true } },
    { type: "internal_alert", config: { userId: "specific-user", message: "Email alert", channel: "email", includeThreadLink: false } },
    { type: "stop", config: { reason: "Handed to sales", outcome: "cancelled" } },
    { type: "create_task", config: { assigneeType: "owner", title: "Must not run", dueInDays: 0 } },
  ]);
  const before = Date.now();
  assert.equal((await app.exports.enrollNewLeadFlows(app.contactId))[0]?.reason, "cancelled");
  assert.equal(app.db.crm_tasks.length, 2);
  assert.equal(app.db.crm_tasks[0].assigned_to, "sales-owner");
  assert.equal(app.db.crm_tasks[0].priority, "high");
  assert.equal(app.db.crm_tasks[0].notes, "Customer requested contact");
  assert.ok(Date.parse(String(app.db.crm_tasks[0].due_at)) >= before + 2 * 86400_000);
  assert.equal(app.db.crm_tasks[1].assigned_to, "specific-user");
  assert.equal(app.db.internal_notifications.length, 2);
  assert.equal(app.db.internal_notifications[0].user_id, "sales-owner");
  assert.equal(app.db.internal_notifications[1].include_thread_link, false);
  assert.equal(app.deliveries[0].mail.to, "specific-user@example.com");
  assert.equal(app.deliveries[0].mail.text, "Email alert");
});

test("category actions trigger matching category flows and subsequent conditions read the saved value", async () => {
  const app = runtime();
  const categoryFlowId = randomUUID();
  app.db.flows.push({ ...app.db.flows[0], id: categoryFlowId, trigger_type: "category_changed", trigger_config: { category: "Interested" } });
  steps(app, [
    { type: "change_category", config: { category: "Interested", reason: "Good fit" } },
    { type: "if_condition", config: { field: "category_is", category: "Interested", action: "continue", unmatchedAction: "stop_flow" } },
    { type: "create_task", config: { assigneeType: "owner", title: "Original flow", dueInDays: 0 } },
  ]);
  app.db.flow_steps.push({ id: randomUUID(), flow_id: categoryFlowId, position: 0, type: "create_task", config: { assigneeType: "owner", title: "Category flow", dueInDays: 0 } });
  await app.exports.enrollNewLeadFlows(app.contactId);
  assert.equal(app.db.email_inbox_state[0].category, "Interested");
  assert.equal(app.db.crm_tasks.length, 2);
  assert.ok(app.db.crm_tasks.some(task => task.title === "Category flow"));
});

test("all conditions honor both branches and continue, skip or stop", async () => {
  for (const field of ["customer_replied", "category_is", "opened_email", "clicked_link"]) for (const matched of [true, false]) for (const action of ["continue", "skip_next", "stop_flow"]) {
    const app = runtime();
    steps(app, [
      { type: "wait", config: { amount: 1, unit: "minutes" } },
      { type: "if_condition", config: { field, category: "Interested", action: matched ? action : "continue", unmatchedAction: matched ? "continue" : action, lookbackDays: 7 } },
      { type: "create_task", config: { assigneeType: "owner", title: "Branch task", dueInDays: 0 } },
      { type: "stop", config: { outcome: "completed" } },
    ]);
    await app.exports.enrollNewLeadFlows(app.contactId);
    const run = app.db.flow_runs[0];
    if (matched && field === "customer_replied") app.db.emails = [{ contact_id: app.contactId, direction: "received", created_at: new Date(Date.now() + 1).toISOString() }];
    if (matched && field === "category_is") app.db.email_inbox_state = [{ user_id: "owner", message_key: run.conversation_id, category: "Interested" }];
    if (matched && ["opened_email", "clicked_link"].includes(field)) app.db.flow_run_logs.push({ run_id: run.id, created_at: new Date().toISOString(), result: { action: field === "opened_email" ? "email_opened" : "link_clicked" } });
    run.next_run_at = new Date(Date.now() - 1).toISOString();
    await app.exports.processFlowRun(String(run.id));
    assert.equal(app.db.crm_tasks?.length ?? 0, action === "continue" ? 1 : 0, `${field}: ${matched}, ${action}`);
    const branch = app.db.flow_run_logs.find(log => (log.result as Row)?.action === "condition_evaluated");
    assert.equal((branch?.result as Row).matched, matched, field);
  }
});

test("business-hours email steps defer and then resume without rerunning earlier actions", async () => {
  const resumeAt = new Date(Date.now() + 3600_000);
  const app = runtime({ businessWindow: resumeAt });
  (app.db.flow_steps[0].config as Row).sendWindow = "business_hours";
  await app.exports.enrollNewLeadFlows(app.contactId);
  assert.equal(app.delivered(), 0);
  assert.equal(app.db.flow_runs[0].next_run_at, resumeAt.toISOString());
  assert.equal(app.db.flow_runs[0].locked_at, null);
});

test("paused waits preserve the enrolled definition across edits and resume with it", async () => {
  const app = runtime();
  steps(app, [{ type: "wait", config: { amount: 1, unit: "hours" } }, { type: "create_task", config: { assigneeType: "owner", title: "Original task", dueInDays: 0 } }]);
  await app.exports.enrollNewLeadFlows(app.contactId);
  const run = app.db.flow_runs[0]; run.next_run_at = new Date(Date.now() - 1).toISOString();
  steps(app, [{ type: "stop", config: { reason: "New definition" } }]);
  app.db.flows[0].status = "paused";
  assert.equal((await app.exports.processFlowRun(String(run.id))).status, "paused");
  assert.equal(app.db.crm_tasks?.length ?? 0, 0);
  app.db.flows[0].status = "live";
  assert.equal((await app.exports.processFlowRun(String(run.id))).status, "done");
  assert.equal(app.db.crm_tasks[0].title, "Original task");
});

test("no-reply triggers accept upstream automation but avoid their own follow-up loop", async () => {
  for (const source of ["manual", "other-flow", "same-flow"]) {
    const app = runtime();
    Object.assign(app.db.flows[0], { trigger_type: "no_reply", trigger_config: { amount: 1, unit: "hours" } });
    steps(app, [{ type: "stop", config: { outcome: "completed" } }]);
    app.db.emails = [{ id: "outbound", contact_id: app.contactId, direction: "sent", status: "sent", message_id: "<outbound@example.com>", thread_id: "thread", sent_at: new Date(Date.now() - 2 * 3600_000).toISOString() }];
    if (source !== "manual") {
      app.db.flow_runs = [{ id: "source-run", flow_id: source === "same-flow" ? app.flowId : "other-flow", status: "done" }];
      app.db.flow_run_logs = [{ run_id: "source-run", result: { action: "email_sent", messageId: "<outbound@example.com>" } }];
    }
    assert.equal(await app.exports.scanTimeBasedFlowTriggers(app.flowId), source === "same-flow" ? 0 : 1);
    assert.equal(await app.exports.scanTimeBasedFlowTriggers(app.flowId), 0);
  }
});

test("both real source lists enroll immediately and scanner recovery cannot duplicate membership", async () => {
  for (const [source, listId] of [["shopify_b2b_form", "Shopify B2B leads"], ["meta_lead_ads", "Meta ad leads"]]) {
    const app = runtime();
    app.db.contacts[0].consent_source = source;
    Object.assign(app.db.flows[0], { trigger_type: "lead_added_to_list", trigger_config: { listId } });
    assert.equal((await app.exports.enrollNewLeadFlows(app.contactId))[0]?.reason, "done");
    assert.equal(app.delivered(), 1);
    assert.equal(await app.exports.scanTimeBasedFlowTriggers(app.flowId), 0);
    await app.exports.enrollNewLeadFlows(app.contactId);
    assert.equal(app.delivered(), 1);
  }
});

test("segment events respect every company filter", async () => {
  for (const type of ["company_segment_changed"] as const) {
    const app = runtime();
    const config = { segment: "Shopify B2B lead", country: "US", companyStatus: "new", minFitScore: 7, ...(type === "pipeline_stage_changed" ? { stage: "new" } : {}) };
    Object.assign(app.db.flows[0], { trigger_type: type, trigger_config: config });
    app.db.company_profiles = [{ company_id: app.companyId, fit_score: 8 }];
    const event = { type, contactId: app.contactId, companyId: app.companyId, conversationId: "company-change", segment: "Shopify B2B lead", stage: "new" };
    assert.equal((await app.exports.enrollMatchingFlows(event))[0]?.reason, "done");
    for (const mismatch of [{ country: "GB" }, { segment: "Reseller" }, { companyStatus: "customer" }, { minFitScore: 10 }]) {
      app.db.flows[0].trigger_config = { ...config, ...mismatch };
      assert.equal((await app.exports.enrollMatchingFlows(event))[0]?.enrolled, false);
    }
    assert.equal(app.delivered(), 1);
  }
});

test("stop-on-reply cancels templates only when enabled", async () => {
  for (const stopOnReply of [true, false]) {
    const app = runtime();
    const email = app.db.flow_steps[0];
    steps(app, [{ type: "wait", config: { amount: 1, unit: "minutes" } }, { type: "send_email", config: { ...(email.config as flows.JsonConfig), stopOnReply } }]);
    await app.exports.enrollNewLeadFlows(app.contactId);
    const run = app.db.flow_runs[0];
    app.db.emails = [{ contact_id: app.contactId, direction: "received", created_at: new Date(Date.now() + 1).toISOString() }];
    run.next_run_at = new Date(Date.now() - 1).toISOString();
    assert.equal((await app.exports.processFlowRun(String(run.id))).status, stopOnReply ? "cancelled" : "done");
    assert.equal(app.delivered(), stopOnReply ? 0 : 1);
  }
});

test("concurrent production ticks claim a due email step once", async () => {
  const app = runtime();
  const email = app.db.flow_steps[0];
  steps(app, [{ type: "wait", config: { amount: 1, unit: "minutes" } }, { type: "send_email", config: email.config as flows.JsonConfig }]);
  await app.exports.enrollNewLeadFlows(app.contactId);
  const run = app.db.flow_runs[0]; run.next_run_at = new Date(Date.now() - 1).toISOString();
  await Promise.all([app.exports.processFlowRun(String(run.id)), app.exports.processFlowRun(String(run.id))]);
  assert.equal(app.delivered(), 1);
});

test("one broken run cannot block other due flows", async () => {
  const app = runtime();
  steps(app, [{ type: "stop", config: {} }]);
  app.db.flow_runs = [
    { id: "broken", flow_id: "missing-flow", contact_id: app.contactId, status: "active", current_step: 0, next_run_at: null, conversation_id: "broken" },
    { id: "good", flow_id: app.flowId, contact_id: app.contactId, company_id: app.companyId, status: "active", current_step: 0, started_at: new Date().toISOString(), next_run_at: null, event_key: `new_lead:${app.contactId}`, conversation_id: "good" },
  ];
  const results = await app.exports.processDueFlowRuns(50, { syncMailbox: false }) as Array<{ runId: string; status: string }>;
  assert.equal(results.find(result => result.runId === "broken")?.status, "error");
  assert.equal(results.find(result => result.runId === "good")?.status, "done");
});

test("old contacts, drafts, paused flows, and unmatched profile filters do not send", async () => {
  for (const change of [
    { status: "draft" }, { status: "paused" },
    { lead_enrollment_started_at: new Date(Date.now() + 60_000).toISOString() },
    { lead_enrollment_started_at: null }, { trigger_config: { segment: "Reseller" } },
  ]) {
    const app = runtime();
    Object.assign(app.db.flows[0], change);
    await app.exports.enrollNewLeadFlows(app.contactId);
    assert.equal(app.delivered(), 0);
    assert.equal(app.db.flow_runs?.length ?? 0, 0);
  }
});

test("a new lead begins its configured wait immediately", async () => {
  const app = runtime();
  app.db.flow_steps = [{ id: randomUUID(), flow_id: app.flowId, position: 0, type: "wait", config: { amount: 5, unit: "minutes" } }, ...app.db.flow_steps.map((step) => ({ ...step, position: 1 }))];
  const before = Date.now();
  assert.equal((await app.exports.enrollNewLeadFlows(app.contactId))[0]?.reason, "waiting");
  assert.ok(Date.parse(String(app.db.flow_runs[0].next_run_at)) >= before + 299_000);
  assert.equal(app.delivered(), 0);
});

test("unverified, unsubscribed, and suppressed contacts record the delivery blocker", async () => {
  for (const reason of ["Address is not verified", "Contact unsubscribed", "Address is on the suppression list"]) {
    const app = runtime();
    if (reason === "Address is not verified") app.db.contacts[0].verification_status = "unverified";
    if (reason === "Contact unsubscribed") app.db.contacts[0].unsubscribed = true;
    if (reason === "Address is on the suppression list") app.db.suppression = [{ email: "lead@example.com" }];
    assert.equal((await app.exports.enrollNewLeadFlows(app.contactId))[0]?.reason, "failed");
    assert.ok(app.db.flow_run_logs.some((log) => log.error === reason));
    assert.equal(app.delivered(), 0);
  }
});

test("dry-run mode records the email without SMTP delivery", async () => {
  const app = runtime();
  app.env.dryRun = true;
  assert.equal((await app.exports.enrollNewLeadFlows(app.contactId))[0]?.reason, "done");
  assert.ok(app.db.flow_run_logs.some((log) => (log.result as Row)?.action === "email_dry_run"));
  assert.equal(app.delivered(), 0);
});

test("website and Meta inquiries send after the wait without changing verification status", async () => {
  for (const source of ["shopify_b2b_form", "shopify_b2b_form_opt_in", "meta_lead_ads"]) {
    const app = runtime();
    Object.assign(app.db.contacts[0], { consent_source: source, verification_status: "unverified" });
    app.db.flow_steps = [{ id: randomUUID(), flow_id: app.flowId, position: 0, type: "wait", config: { amount: 2, unit: "minutes" } }, ...app.db.flow_steps.map((step) => ({ ...step, position: 1 }))];
    await app.exports.enrollNewLeadFlows(app.contactId);
    const run = app.db.flow_runs[0];
    assert.equal(app.delivered(), 0);
    assert.equal((await app.exports.processFlowRun(String(run.id))).status, "active");
    assert.equal(app.delivered(), 0);
    run.next_run_at = new Date(Date.now() - 1).toISOString();
    assert.equal((await app.exports.processFlowRun(String(run.id))).status, "done");
    assert.equal(app.delivered(), 1);
    await app.exports.processFlowRun(String(run.id));
    assert.equal(app.delivered(), 1);
    assert.equal(app.db.contacts[0].verification_status, "unverified");
  }
});

test("received inquiries can be answered; risky and invalid form addresses stay blocked", async () => {
  const app = runtime();
  app.db.contacts[0].verification_status = "unverified";
  Object.assign(app.db.flows[0], { trigger_type: "email_received", email_enrollment_started_at: new Date(Date.now() - 60_000).toISOString() });
  const receivedAt = new Date().toISOString();
  app.db.emails = [{ id: randomUUID(), contact_id: app.contactId, direction: "received", created_at: receivedAt }];
  assert.equal((await app.exports.enrollMatchingFlows({ type: "email_received", contactId: app.contactId, conversationId: "inbound-thread", occurredAt: receivedAt }))[0]?.reason, "done");
  assert.equal(app.delivered(), 1);
  for (const status of ["invalid", "risky"]) {
    const blocked = runtime();
    Object.assign(blocked.db.contacts[0], { verification_status: status, consent_source: "shopify_b2b_form" });
    assert.equal((await blocked.exports.enrollNewLeadFlows(blocked.contactId))[0]?.reason, "failed");
    assert.equal(blocked.delivered(), 0);
  }
});

test("email activation excludes historical mail and paused flows", async () => {
  for (const change of [{}, { status: "paused" }]) {
    const app = runtime();
    Object.assign(app.db.flows[0], { trigger_type: "email_received", email_enrollment_started_at: new Date().toISOString(), ...change });
    await app.exports.enrollMatchingFlows({ type: "email_received", contactId: app.contactId, conversationId: "old-thread", occurredAt: new Date(Date.now() - 3600_000).toISOString() });
    assert.equal(app.delivered(), 0);
    assert.equal(app.db.flow_runs?.length ?? 0, 0);
  }
});

test("minute resume worker recovers a website lead, waits, then sends once without IMAP", async () => {
  const app = runtime();
  Object.assign(app.db.contacts[0], { consent_source: "shopify_b2b_form", verification_status: "unverified" });
  app.db.flow_steps = [{ id: randomUUID(), flow_id: app.flowId, position: 0, type: "wait", config: { amount: 2, unit: "minutes" } }, ...app.db.flow_steps.map((step) => ({ ...step, position: 1 }))];
  await app.exports.processDueFlowRuns(50, { syncMailbox: false });
  assert.equal(app.delivered(), 0);
  assert.equal(app.db.flow_runs[0].current_step, 1);
  assert.equal(Date.parse(String(app.db.flow_runs[0].next_run_at)) - Date.parse(String(app.db.contacts[0].created_at)), 120_000);
  app.db.flow_runs[0].next_run_at = new Date(Date.now() - 1).toISOString();
  await app.exports.processDueFlowRuns(50, { syncMailbox: false });
  await app.exports.processDueFlowRuns(50, { syncMailbox: false });
  assert.equal(app.delivered(), 1);
  assert.equal(app.db.flow_runs.length, 1);
});

test("minute worker enrolls a new received email and skips historical messages and retries", async () => {
  const app = runtime();
  Object.assign(app.db.flows[0], { trigger_type: "email_received", email_enrollment_started_at: new Date(Date.now() - 60_000).toISOString() });
  app.db.contacts[0].verification_status = "unverified";
  app.db.emails = [
    { id: "old", contact_id: app.contactId, direction: "received", thread_id: "old", created_at: new Date(Date.now() - 3600_000).toISOString() },
    { id: "new", contact_id: app.contactId, direction: "received", thread_id: "new", created_at: new Date().toISOString() },
  ];
  await app.exports.processDueFlowRuns(50, { syncMailbox: false });
  await app.exports.processDueFlowRuns(50, { syncMailbox: false });
  assert.equal(app.db.flow_runs.length, 1);
  assert.equal(app.db.flow_runs[0].event_key, "email_received:new");
  assert.equal(app.delivered(), 1);
});
