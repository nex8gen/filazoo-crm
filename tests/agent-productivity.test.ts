import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import * as tools from "../lib/ai/crm-tools.ts";
import * as productivity from "../lib/ai/crm-productivity.ts";
import * as csv from "../lib/company-export.ts";
import * as invoices from "../lib/invoices.ts";
import * as permissions from "../lib/invoice-permissions.ts";
import * as segments from "../lib/segments.ts";
import * as flows from "../lib/flows.ts";
import * as orders from "../lib/purchase-orders.ts";
import * as products from "../lib/product-utils.ts";

const require = createRequire(import.meta.url);
const actorId = "a1111111-1111-4111-8111-111111111111";
const recordId = "b2222222-2222-4222-8222-222222222222";
const companyId = "c3333333-3333-4333-8333-333333333333";
const actionId = "d4444444-4444-4444-8444-444444444444";
const otherId = "e5555555-5555-4555-8555-555555555555";
const viewer = { id: actorId, role: "admin" as const, displayName: "Audit", email: "sales@example.com" };
const request = new Request("https://crm.example.com/api/ai/assistant/action");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function load<T>(file: string, dependencies: Record<string, unknown>) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? require(name), crypto, Date, Intl, URL, Request, Response, FormData, Error, console });
  return exports as T;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- This fake database stores heterogeneous service rows.
type Row = Record<string, any>;
function fixture() {
  const tables: Record<string, Row[]> = {
    crm_tasks: [{ id: recordId, assigned_to: actorId, company_id: companyId, title: "Call buyer", notes: "Keep notes", priority: "normal", status: "open", due_at: "2099-10-30T01:00:00Z", updated_at: "2026-10-29T00:00:00Z" }],
    email_auto_replies: [], workspace_agent_actions: [],
    catalogs: [{ id: recordId, company_id: companyId, version: 2, currency: "USD", product_skus: ["PLA"] }],
    email_reply_knowledge: [{ id: recordId, title: "Agreed policy", content: "Only approved lead times may be quoted." }],
  };
  let failTable = "";
  let race: (() => void) | undefined;
  const calls: Array<{ name: string; body?: Row }> = [];
  const db = { from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | undefined, insertion: Row | undefined, upsert = false;
    const run = () => {
      if (table === failTable) return { data: null, error: { code: "DB_FAILURE" }, count: null };
      if (patch && race) { const trigger = race; race = undefined; trigger(); }
      const saved = tables[table] ??= [];
      if (insertion && (!upsert || !saved.some((row) => row.id === insertion!.id))) saved.push({ ...insertion, updated_at: "2026-10-29T00:00:00Z" });
      const rows = saved.filter((row) => filters.every((filter) => filter(row)));
      if (patch) rows.forEach((row) => Object.assign(row, patch));
      return { data: rows.map((row) => ({ ...row })), error: null, count: rows.length };
    };
    const q = { select() { return q; }, eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return q; },
      in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return q; }, order() { return q; }, range() { return q; },
      update(value: Row) { patch = value; return q; }, insert(value: Row) { insertion = value; return q; }, upsert(value: Row) { insertion = value; upsert = true; return q; },
      async maybeSingle() { const r = run(); return { ...r, data: r.data?.[0] ?? null }; }, async single() { return q.maybeSingle(); },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(run()).then(resolve); } };
    return q;
  } };
  const company = { id: companyId, name: "=HYPERLINK(\"https://invalid.example\")", domain: "example.com", country: "US", segment: "Printing", stage: "Profile created", ownerName: "Audit", fitScore: 7, contact: "Buyer", contactRole: "Owner", email: "buyer@example.com", nextAction: "Call", source: "manual", sourceLabel: "Manual", hasEmail: true };
  const companyList = [company];
  const invoice = { id: recordId, number: 37, status: "draft", revision: 3, created_by: actorId, document: { ...invoices.blankInvoiceDocument("2026-10-29"), companyId, customerName: "Audit", items: [{ description: "Synthetic", quantity: 4, unitPriceMinor: 250, taxBps: 0 }] } };
  const automation: Row = { id: recordId, mailbox_id: otherId, user_id: actorId, assigned_to: actorId, recipient: "buyer@example.com", enabled: false, status: "paused", revision: 3, pending_document: null };
  let foundAutomation: Row | null = automation;
  let inbound = true, routeFailure = false;
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath() {} },
    "../supabase/admin": { createSupabaseAdmin: () => db }, "../auth": {},
    "../email-auto-reply": { isAutoReplySchemaMissing: () => false }, "../ai/crm-productivity": productivity,
    "../data/crm": { listCompanies: async () => ({ mode: "live", companies: companyList }) },
    "../data/segments": { getSavedSegment: async (id: string) => id === recordId ? { id, name: "US", rules: { country: "US" } } : null },
    "../segments": segments, "../company-export": csv, "./crm-productivity": productivity,
    "../data/invoices": { getInvoice: async () => invoice }, "../invoice-permissions": permissions,
    "../invoices": invoices, "./agent-records": { loadAgentCompany: async () => ({ id: companyId, fields: { name: "Audit" } }), loadAgentEmails: async () => ({ mailboxId: otherId, current: { id: "internal-email", messageId: "<verified@customer.example>", subject: "Test conversation", contact: "buyer@example.com" } }) },
    "../data/email-auto-reply": { findAutoReply: async () => ({ row: foundAutomation, conversation: inbound ? [{ direction: "inbound", messageId: "<verified@customer.example>" }] : [] }), getAutoReply: async () => automation, presentAutoReply: (row: Row | null) => row ? { ...row } : null },
    "@/app/api/email/auto-reply/route": { POST: async (input: Request) => { calls.push({ name: "autoReply", body: await input.json() }); assert.equal(input.headers.get("origin"), "https://crm.example.com"); return Response.json(routeFailure ? { error: "Automation changed" } : { ok: true, automation }, { status: routeFailure ? 409 : 200 }); } },
    "@/app/api/email/auto-reply/knowledge/route": { POST: async (input: Request) => { calls.push({ name: "addFact", body: await input.json() }); return Response.json({ ok: true, fact: { id: actionId } }); }, DELETE: async (input: Request) => { calls.push({ name: "deleteFact", body: { url: input.url } }); return Response.json({ ok: true }); } },
  };
  const taskService = load<typeof import("../lib/data/agent-tasks.ts")>("../lib/data/agent-tasks.ts", dependencies);
  dependencies["../data/agent-tasks"] = taskService;
  const exportService = load<typeof import("../lib/ai/company-export-records.ts")>("../lib/ai/company-export-records.ts", dependencies);
  dependencies["./company-export-records"] = exportService;
  const extended = load<typeof import("../lib/ai/crm-productivity-execution.ts")>("../lib/ai/crm-productivity-execution.ts", dependencies);
  const legacyStubs = Object.fromEntries(["@/app/crm-actions", "@/app/settings/actions", "@/app/settings/preference-actions", "@/app/segment-actions", "@/app/inventory-actions", "../data/inventory", "@/app/purchase-order-actions", "@/app/api/email/state/route", "../meta-messenger", "../data/flows", "../data/invoice-connections", "../invoice-payment-methods", "../data/invoice-payment-methods", "../invoice-defaults", "../user-preferences", "../data/members", "../data/flow-activity"].map((name) => [name, {}]));
  const execution = load<typeof import("../lib/ai/crm-execution.ts")>("../lib/ai/crm-execution.ts", { ...legacyStubs, ...dependencies, "next/cache": { revalidatePath() {} }, "./crm-tools": tools, "./crm-productivity-execution": extended, "../flows": flows, "../purchase-orders": orders, "../product-utils": products });
  const download = load<typeof import("../app/api/ai/assistant/download/route.ts")>("../app/api/ai/assistant/download/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/supabase/admin": { createSupabaseAdmin: () => db },
    "@/lib/ai/company-export-records": exportService, "@/lib/company-export": csv, "@/lib/ai/crm-tools": tools,
  });
  return { ...execution, taskService, exportService, download, tables, calls, company, companyList, invoice, automation, dependencies,
    noAutomation() { foundAutomation = null; }, noInbound() { inbound = false; }, routeFailure() { routeFailure = true; }, fail(table: string) { failTable = table; }, race(callback: () => void) { race = callback; } };
}

test("company CSV preserves Unicode/quotes/newlines and neutralizes spreadsheet formulas in both export paths", () => {
  for (const value of ["=1+1", "+CMD", "-1+2", "@SUM(A1)", " \t=HYPERLINK()", "\n+formula"]) assert.ok(csv.csvCell(value).startsWith('"\''));
  assert.equal(csv.csvCell('A "quoted"\nname'), '"A ""quoted""\nname"');
  const f = fixture();
  assert.ok(csv.companyExportCsv([f.company as unknown as csv.ExportCompany]).startsWith("\uFEFF"));
  assert.ok(csv.companyExportCsv([f.company as unknown as csv.ExportCompany]).includes("'="));
});

test("batch protocol accepts independent reads and rejects duplicate or combined protocols", () => {
  const reads = tools.extractCrmReadBatch('FILAZOO_CRM_READS_JSON: [{"resource":"tasks"},{"resource":"inventory","id":"PLA-BLACK"}]');
  assert.equal(reads?.length, 2);
  for (const output of [
    'FILAZOO_CRM_READS_JSON: [{"resource":"tasks"},{"resource":"tasks"}]',
    'FILAZOO_CRM_READS_JSON: [{"resource":"tasks"}]',
    'FILAZOO_ACTIONS_JSON: []\nFILAZOO_CRM_READS_JSON: [{"resource":"tasks"},{"resource":"inventory"}]',
    'FILAZOO_CRM_READ_JSON: {"resource":"tasks"}\nFILAZOO_CRM_READS_JSON: [{"resource":"tasks"},{"resource":"inventory"}]',
  ]) assert.throws(() => tools.extractCrmReadBatch(output));
});

test("general tasks create once, preserve omitted fields and cannot affect a teammate or AI shipping task", async () => {
  const f = fixture();
  const operation = tools.crmOperationSchema.parse({ op: "create_task", title: "Audit follow-up", dueAt: "2099-10-30T09:00:00+08:00" });
  const proposal = await f.prepareCrmAction(operation, viewer);
  const saved = await f.executeCrmAction(proposal, viewer, actionId, request);
  assert.equal(saved.taskId, actionId); assert.equal(f.tables.crm_tasks.length, 2);
  await f.executeCrmAction(proposal, viewer, actionId, request);
  assert.equal(f.tables.crm_tasks.length, 2, "A retried execution ID must not duplicate a task");
  const edit = await f.prepareCrmAction({ op: "update_task", taskId: recordId, changes: { priority: "high", dueAt: null } }, viewer);
  await f.executeCrmAction(edit, viewer, otherId, request);
  assert.equal(f.tables.crm_tasks[0].title, "Call buyer"); assert.equal(f.tables.crm_tasks[0].notes, "Keep notes");
  assert.equal(f.tables.crm_tasks[0].priority, "high"); assert.equal(f.tables.crm_tasks[0].due_at, null);
  await assert.rejects(() => f.executeCrmAction(edit, viewer, otherId, request), /changed/);
  await assert.rejects(() => f.prepareCrmAction({ op: "update_task", taskId: recordId, changes: { title: "Steal" } }, { ...viewer, id: otherId }), /another teammate/);
  f.tables.email_auto_replies.push({ id: otherId, task_id: recordId, enabled: true });
  await assert.rejects(() => f.prepareCrmAction({ op: "update_task", taskId: recordId, changes: { status: "done" } }, viewer), /managed by AI/);
  await assert.rejects(() => f.prepareCrmAction(operation, { ...viewer, role: "viewer" }), /read-only/);
});

test("task timestamp races and database failures never report a saved update", async () => {
  const f = fixture();
  f.race(() => { f.tables.crm_tasks[0].updated_at = "2026-10-29T00:01:00Z"; });
  await assert.rejects(() => f.taskService.updateAgentTask(viewer, recordId, "2026-10-29T00:00:00Z", { title: "Changed" }), /changed/);
  assert.equal(f.tables.crm_tasks[0].title, "Call buyer");
  f.fail("crm_tasks");
  await assert.rejects(() => f.taskService.createAgentTask(viewer, actionId, { op: "create_task", title: "Fail" }), /Unable to create/);
});

test("company task markers stay linked and scheduled follow-ups cannot silently lose their due time", async () => {
  const f = fixture();
  const task = f.tables.crm_tasks[0];
  task.notes = "Scheduled from intelligent next follow-up recommendation.";
  await assert.rejects(() => f.taskService.updateAgentTask(viewer, recordId, task.updated_at, { notes: "Erase link" }), /cannot be changed/);
  await assert.rejects(() => f.taskService.updateAgentTask(viewer, recordId, task.updated_at, { dueAt: null }), /require a due time/);
  task.status = "done";
  await assert.rejects(() => f.taskService.updateAgentTask(viewer, recordId, task.updated_at, { status: "open" }), /Schedule a new follow-up/);
  task.notes = "Company purchase analysis: PLA";
  await assert.rejects(() => f.taskService.updateAgentTask(viewer, recordId, task.updated_at, { notes: "Erase product link" }), /cannot be changed/);
});

test("export selection resolves audiences, rejects missing records and snapshots exported fields only", async () => {
  const f = fixture();
  const snapshot = await f.exportService.companyExportSnapshot({ scope: "selected", companyIds: [companyId] });
  const before = hash(snapshot.value);
  Object.assign(f.company, { ownerAvatarUrl: "changed" });
  assert.equal(hash((await f.exportService.companyExportSnapshot({ scope: "selected", companyIds: [companyId] })).value), before);
  f.company.email = "changed@example.com";
  assert.notEqual(hash((await f.exportService.companyExportSnapshot({ scope: "selected", companyIds: [companyId] })).value), before);
  assert.equal((await f.exportService.companyExportSnapshot({ scope: "segment", segmentId: recordId })).records.length, 1);
  await assert.rejects(() => f.exportService.companyExportSnapshot({ scope: "selected", companyIds: [otherId] }), /unavailable/);
  assert.equal(productivity.exportSelectionSchema.safeParse({ scope: "all", companyIds: [companyId] }).success, false);
});

test("CSV download requires completed owner approval, expiry and an unchanged selection", async () => {
  const f = fixture();
  const proposal = await f.prepareCrmAction({ op: "export_companies", selection: { scope: "selected", companyIds: [companyId] } }, viewer);
  const result = await f.executeCrmAction(proposal, viewer, actionId, request);
  assert.equal(result.href, `/api/ai/assistant/download?id=${actionId}`);
  const row = { id: actionId, user_id: actorId, action: proposal, status: "pending", expires_at: new Date(Date.now() + 60000).toISOString() };
  f.tables.workspace_agent_actions.push(row);
  const get = () => f.download.GET(new Request(`https://crm.example.com${result.href}`));
  assert.equal((await get()).status, 409);
  row.status = "completed";
  const downloaded = await get();
  assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get("Content-Type")!, /text\/csv/);
  assert.equal(downloaded.headers.get("Cache-Control"), "private, no-store"); assert.ok((await downloaded.text()).includes("'="));
  row.user_id = otherId; assert.equal((await get()).status, 404); row.user_id = actorId;
  f.company.name = "Changed after review"; assert.equal((await get()).status, 409);
  row.expires_at = "2020-01-01T00:00:00Z"; assert.equal((await get()).status, 410);
});

test("PDF actions return authenticated download endpoints and reject stale invoices and arbitrary URLs", async () => {
  const f = fixture();
  for (const kind of ["invoice", "catalog"] as const) {
    const proposal = await f.prepareCrmAction({ op: "download_document", kind, id: recordId }, viewer);
    const saved = await f.executeCrmAction(proposal, viewer, actionId, request);
    assert.equal(saved.href, kind === "invoice" ? `/api/invoices/${recordId}/pdf` : `/api/catalogs/${recordId}/pdf?download=1`);
    if (kind === "invoice") { f.invoice.revision++; await assert.rejects(() => f.executeCrmAction(proposal, viewer, actionId, request), /changed/); }
  }
  assert.equal(tools.crmOperationSchema.safeParse({ op: "download_document", kind: "invoice", id: "https://outside.example/file" }).success, false);
});

test("conversation AI binds to saved headers and receiving mailbox and always requires manual approval", async () => {
  const f = fixture();
  const operation = { op: "conversation_auto_reply" as const, emailId: "internal-email", enabled: true };
  const proposal = await f.prepareCrmAction(operation, viewer);
  assert.equal(tools.crmManualApproval(operation), true); assert.equal(f.calls.length, 0);
  await f.executeCrmAction(proposal, viewer, actionId, request);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].body)), { action: "enable", mailboxId: otherId, senderId: otherId, messageId: "<verified@customer.example>", revision: 3 });
  f.automation.enabled = true; f.automation.status = "waiting_shipping";
  const already = await f.prepareCrmAction(operation, viewer);
  await f.executeCrmAction(already, viewer, otherId, request);
  assert.equal(f.calls.length, 1, "Enabling again must not reset pending shipping review");
  const stop = await f.prepareCrmAction({ ...operation, enabled: false }, viewer);
  f.automation.revision++;
  await f.executeCrmAction(stop, viewer, actionId, request);
  assert.equal(f.calls[1].body.action, "stop"); assert.equal(f.calls[1].body.id, recordId);
  f.noInbound();
  await assert.rejects(() => f.prepareCrmAction(operation, viewer), /received customer email/);
  assert.equal(tools.crmOperationSchema.safeParse({ ...operation, to: "attacker@example.com" }).success, false);
});

test("shipping approval shows actual cents/totals and queues without claiming successful delivery", async () => {
  const f = fixture();
  f.automation.enabled = true; f.automation.status = "waiting_shipping"; f.automation.pending_document = f.invoice.document;
  const proposal = await f.prepareCrmAction({ op: "approve_auto_reply_shipping", automationId: recordId, shippingMinor: 5000 }, viewer);
  assert.equal(proposal.preview.totalMinor, 6000);
  const result = await f.executeCrmAction(proposal, viewer, actionId, request);
  assert.match(result.success!, /queued/); assert.match(result.success!, /not yet confirmed/);
  assert.equal(f.calls[0].body.shippingMinor, 5000); assert.equal(f.calls[0].body.revision, 3);
  f.routeFailure();
  await assert.rejects(() => f.executeCrmAction(proposal, viewer, actionId, request), /Automation changed/);
  f.automation.assigned_to = otherId;
  await assert.rejects(() => f.prepareCrmAction(proposal.operation, { ...viewer, role: "bd_manager" }), /assigned user/);
});

test("approved knowledge uses existing services with operator review, stale checks and no automatic promotion", async () => {
  const f = fixture();
  const operation = { op: "add_business_fact" as const, title: "Approved policy", content: "Only the user-approved policy is stored." };
  assert.equal(tools.crmManualApproval(operation), true);
  const proposal = await f.prepareCrmAction(operation, viewer);
  const saved = await f.executeCrmAction(proposal, viewer, actionId, request);
  assert.equal(saved.factId, actionId); assert.equal(f.calls[0].body.content, operation.content);
  await assert.rejects(() => f.prepareCrmAction(operation, { ...viewer, role: "bd_manager" }), /admin or operator/);
  const deletion = await f.prepareCrmAction({ op: "delete_business_fact", factId: recordId }, viewer);
  f.tables.email_reply_knowledge[0].content = "Changed policy";
  await assert.rejects(() => f.executeCrmAction(deletion, viewer, otherId, request), /changed/);
  assert.equal(f.calls.some((call) => call.name === "deleteFact"), false);
  const refreshed = await f.prepareCrmAction({ op: "delete_business_fact", factId: recordId }, viewer);
  await f.executeCrmAction(refreshed, viewer, otherId, request);
  assert.equal(f.calls.at(-1)?.body.url, `https://crm.example.com/api/email/auto-reply/knowledge?id=${recordId}`);
});

test("large Unicode exports are refused before approval instead of exceeding the hosted response limit", async () => {
  const f = fixture();
  f.company.name = "测".repeat(1_400_000);
  await assert.rejects(() => f.exportService.companyExportSnapshot({ scope: "all" }), /too large/);
});
