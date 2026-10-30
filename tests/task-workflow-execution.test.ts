import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as models from "../lib/task-workflows.ts";
import * as invoices from "../lib/invoices.ts";
import * as permissions from "../lib/invoice-permissions.ts";
import * as threading from "../lib/email-threading.ts";
const require = createRequire(import.meta.url);
const id = "a1111111-1111-4111-8111-111111111111", companyId = "b2222222-2222-4222-8222-222222222222";
const viewer = { id, role: "admin" as const, email: "sales@example.com", displayName: "QA" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Database fixture rows model heterogeneous service tables.
type Row = Record<string, any>;
function fixture() {
  const task: Row = { id, company_id: companyId, assigned_to: id, status: "open", updated_at: "2026-10-30" };
  const invoice = { id, number: 1, status: "draft", revision: 1, created_by: id, total_minor: 1000, paid_minor: 0, document: { ...invoices.blankInvoiceDocument("2026-10-30"), companyId, customerName: "QA", customerEmail: "buyer@example.com", customerAddress: "Saved office", shippingAddress: "99 Test Road", items: [{ description: "PLA", quantity: 1, unitPriceMinor: 1000, taxBps: 0 }] } };
  const work: Row = { task_id: id, owner_id: id, kind: "invoice_review", status: "ready", revision: 1, invoice_id: id, request_id: null, blockers: [], payload: { shippingConfirmed: true, invoiceRevision: 1, recipient: "buyer@example.com", mailboxId: id, subject: "Invoice", text: "Please find your draft invoice attached.", input: { kind: "invoice_review" } } };
  const tables: Record<string, Row[]> = { crm_tasks: [task], crm_task_workflows: [work], email_send_operations: [], suppression: [], contacts: [{ company_id: companyId, email: "buyer@example.com", unsubscribed: false }], agent_reply_requests: [{ id, status: "received" }] };
  const sends: Row[] = [];
  let mode = "success", newerReply = false;
  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []; let changes: Row | undefined; let single = false;
      const run = () => { const rows = (tables[table] ?? []).filter(row => filters.every(f => f(row))); if (changes) rows.forEach(row => Object.assign(row, structuredClone(changes))); return { data: single ? structuredClone(rows[0] ?? null) : structuredClone(rows), count: rows.length, error: null }; };
      const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; }, update: (value: Row) => { changes = value; return q; }, maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; }, throwOnError: async () => run(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve) }; return q;
    },
    rpc(name: string, input: Row) { return { throwOnError: async () => {
      assert.equal(name, "finish_task_workflow");
      const delivery = tables.email_send_operations.find(row => row.id === input.p_payload.deliveryId && row.status === "sent");
      if (input.p_revision !== work.revision || !delivery) return { data: false };
      work.status = "done"; work.revision++; work.payload = input.p_payload; task.status = "done"; return { data: true };
    } }; },
  };
  const access = async () => { if (task.status !== "open") throw new Error("Only an open task can be acted on"); return { task: structuredClone(task), workflow: structuredClone(work), canAct: true }; };
  const detail = async () => ({ workflow: structuredClone(work), invoice: structuredClone(invoice), taskStatus: task.status });
  const deps: Record<string, unknown> = {
    "server-only": {}, "../supabase/admin": { createSupabaseAdmin: () => db },
    "./task-workflows": { taskWorkflowAccess: access, taskWorkflowDetail: detail },
    "../task-workflows": models, "../invoices": invoices, "../invoice-permissions": permissions, "../email-threading": threading,
    "./invoices": { getInvoice: async () => structuredClone(invoice), mutateInvoice: async (_id: string, _actor: string, input: Row) => { assert.equal(input.revision, invoice.revision); invoice.revision++; if (input.document) invoice.document = input.document; return structuredClone(invoice); } },
    "./mailboxes": { getViewerMailbox: async () => ({ id, type: "workspace", email: "sales@example.com" }), mailboxHasSmtp: () => true },
    "./customer-reply-requests": { authorizeReplyRequest: async () => ({ id }) },
    "./task-workflow-preparation": { latestWorkflowEvidence: async () => ({ evidence: { messageId: newerReply ? "<new@example.com>" : "<old@example.com>" } }) },
    "../email-access": { canViewEmail: () => true }, "./email-access": { getAssignedEmailContacts: async () => null },
    "../invoice-pdf": { renderInvoicePdf: async () => Buffer.from("%PDF synthetic fixture") },
    "../invoice-pdf-meta": { invoicePdfFilename: () => "INV-000001.pdf" },
    "./manual-email-send": { deliverEmail: async (_viewer: unknown, input: Row) => {
      sends.push(input);
      tables.email_send_operations.push({ id: input.requestId, user_id: id, status: mode === "uncertain" ? "uncertain" : mode === "failed" ? "failed" : "sent", result: { ok: true } });
      return Response.json(mode === "success" ? { ok: true, saved: true, email: { id: "sent-1", messageId: "<sent@example.com>", timestamp: "2026-10-30" } } : { ok: false, error: "Delivery needs review" }, { status: mode === "success" ? 200 : 500 });
    } },
  };
  const exports = {} as { executeTaskWorkflow: typeof import("../lib/data/task-workflow-execution.ts").executeTaskWorkflow };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/task-workflow-execution.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? require(name), Date, Error, JSON, Buffer, Response, structuredClone, console });
  return { ...exports, task, work, invoice, tables, sends, mode: (next: string) => { mode = next; }, newerReply: () => { newerReply = true; } };
}

test("successful task sends the exact invoice PDF once, then completes the task", async () => {
  const f = fixture();
  await f.executeTaskWorkflow(viewer, id, { action: "send", revision: 1, invoiceRevision: 1, issue: false });
  assert.equal(f.sends.length, 1); assert.equal(f.sends[0].to, "buyer@example.com");
  assert.equal(f.sends[0].attachments[0].filename, "INV-000001.pdf");
  assert.match(Buffer.from(f.sends[0].attachments[0].content, "base64").toString(), /^%PDF/);
  assert.equal(f.work.status, "done"); assert.equal(f.task.status, "done");
  await assert.rejects(() => f.executeTaskWorkflow(viewer, id, { action: "send", revision: f.work.revision, invoiceRevision: 1, issue: false }), /open task/);
  assert.equal(f.sends.length, 1);
});

test("unconfirmed shipping and stale workflow/invoice revisions block delivery before SMTP", async () => {
  for (const scenario of ["shipping", "task", "invoice"]) {
    const f = fixture();
    if (scenario === "shipping") f.work.payload.shippingConfirmed = false;
    if (scenario === "task") f.work.revision = 2;
    if (scenario === "invoice") f.invoice.revision = 2;
    await assert.rejects(() => f.executeTaskWorkflow(viewer, id, { action: "send", revision: 1, invoiceRevision: 1, issue: false }));
    assert.equal(f.sends.length, 0);
  }
});

test("an ambiguous SMTP attempt cannot resend; confirmed delivery can be reconciled", async () => {
  const f = fixture(); f.mode("uncertain");
  await assert.rejects(() => f.executeTaskWorkflow(viewer, id, { action: "send", revision: 1, invoiceRevision: 1, issue: false }));
  assert.equal(f.work.status, "uncertain"); assert.equal(f.task.status, "open");
  await assert.rejects(() => f.executeTaskWorkflow(viewer, id, { action: "send", revision: f.work.revision, invoiceRevision: 1, issue: false }), /existing delivery/);
  assert.equal(f.sends.length, 1);
  f.tables.email_send_operations[0].status = "sent";
  await f.executeTaskWorkflow(viewer, id, { action: "check_delivery", revision: f.work.revision });
  assert.equal(f.work.status, "done"); assert.equal(f.sends.length, 1);
});

test("editing after a safe pre-SMTP failure creates a new send identity and keeps the saved draft", async () => {
  const f = fixture(); f.mode("failed");
  await assert.rejects(() => f.executeTaskWorkflow(viewer, id, { action: "send", revision: 1, invoiceRevision: 1, issue: false }));
  assert.equal(f.work.status, "ready");
  const oldId = f.work.payload.deliveryId;
  await f.executeTaskWorkflow(viewer, id, { action: "save_draft", revision: f.work.revision, subject: "Revised invoice", text: "Please review the corrected draft." });
  assert.equal(f.work.payload.deliveryId, undefined); assert.equal(f.work.payload.input.text, "Please review the corrected draft.");
  f.mode("success");
  await f.executeTaskWorkflow(viewer, id, { action: "send", revision: f.work.revision, invoiceRevision: 1, issue: false });
  assert.notEqual(f.sends[1].requestId, oldId); assert.equal(f.task.status, "done");
});

test("new customer messages, suppression and unsubscribe changes prevent a stale reply", async () => {
  for (const scenario of ["reply", "suppressed", "unsubscribed"]) {
    const f = fixture();
    if (scenario === "reply") { f.work.request_id = id; f.work.payload.evidence = { messageId: "<old@example.com>" }; f.newerReply(); }
    if (scenario === "suppressed") f.tables.suppression.push({ email: "buyer@example.com" });
    if (scenario === "unsubscribed") f.tables.contacts[0].unsubscribed = true;
    await assert.rejects(() => f.executeTaskWorkflow(viewer, id, { action: "send", revision: 1, invoiceRevision: 1, issue: false }));
    assert.equal(f.sends.length, 0);
  }
});
