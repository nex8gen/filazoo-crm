import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../lib/ai/agent-actions.ts";
import * as invoices from "../lib/invoices.ts";
import * as threading from "../lib/email-threading.ts";
import * as commerce from "../lib/company-commerce.ts";
import * as permissions from "../lib/invoice-permissions.ts";
import * as progress from "../lib/ai/agent-progress.ts";
import { workspaceActionSchema } from "../lib/ai/workspace-assistant.ts";

const require = createRequire(import.meta.url);
function moduleUnderTest<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? require(name), Response, Request, URL, FormData, Date, Error, crypto, console, Buffer, Intl });
  return exports as T;
}

function database(tables: Record<string, Record<string, unknown>[]>) {
  return { from(table: string) {
    let inserted: Record<string, unknown>[] | undefined;
    let updated: Record<string, unknown> | undefined;
    const filters = new Map<string, unknown>();
    const run = () => {
      if (inserted) (tables[table] ??= []).push(...inserted);
      const data = (tables[table] ?? []).filter((row) => [...filters].every(([key, value]) => row[key] === value));
      if (updated) data.forEach((row) => Object.assign(row, updated));
      return { data, error: null, count: data.length };
    };
    const query = {
      select() { return query; }, order() { return query; }, limit() { return query; }, not() { return query; }, or() { return query; },
      eq(key: string, value: unknown) { filters.set(key, value); return query; },
      in() { return query; },
      insert(rows: Record<string, unknown> | Record<string, unknown>[]) { inserted = Array.isArray(rows) ? rows : [rows]; return query; },
      update(row: Record<string, unknown>) { updated = row; return query; },
      async maybeSingle() { const result = run(); return { ...result, data: result.data[0] ?? null }; },
      then(resolve: (result: ReturnType<typeof run>) => unknown) { return Promise.resolve(run()).then(resolve); },
    };
    return query;
  } };
}

const companyId = "ad9cb9f8-e098-44f0-a078-20eed16ef1bd";
const invoiceId = "15693adc-0bdf-4617-b214-71b1861764a9";
const actionId = "c8658f23-965c-49b3-a11a-35dc61920fc6";
const viewer = { id: companyId, role: "admin", displayName: "Manager", email: "seller@example.com" } as const;
const document = { ...invoices.blankInvoiceDocument("2026-10-26"), companyId, customerName: "Acme", customerEmail: "buyer@example.com", items: [{ description: "PLA Black", quantity: 200, unitPriceMinor: 500, taxBps: 0 }] };
const invoice = { id: invoiceId, number: 8, status: "draft", revision: 1, document, createdBy: viewer.id };
const request = new Request("http://localhost:3000/api/ai/assistant/action");
const email = { to: "buyer@example.com", subject: "Re: Order", text: "Your requested invoice is attached.", sourceEmailId: "mail-1", delivery: "draft" } as const;

function executionFixture() {
  const tables: Record<string, Record<string, unknown>[]> = { workspace_agent_actions: [{ id: actionId, user_id: viewer.id, status: "running" }] };
  const savedForms: FormData[] = [];
  const sent: Record<string, unknown>[] = [];
  let fingerprint = "a".repeat(64);
  let invoiceReads = 0;
  let bootstrapInput: { companyId?: string; email?: string; threadId?: string } | undefined;
  const company = { id: companyId, fields: { name: "Acme", city: "Old city", summary: "Keep existing summary", contactEmail: "buyer@example.com", "commerce.address": "Saved address", "commerce.taxId": "VAT-OLD" }, contacts: [], fingerprint };
  const dependencies = {
    "next/cache": { revalidatePath() {} },
    "@/app/crm-actions": { createCompany() {}, updateCompany: async (_id: string, _state: unknown, form: FormData) => { savedForms.push(form); return { success: "Customer updated." }; }, addCompanyComment: async (_id: string, _state: unknown, form: FormData) => { savedForms.push(form); return { success: "Note added." }; } },
    "@/app/api/email/send/route": { POST: async (request: Request) => { sent.push(await request.json()); return Response.json({ ok: true, saved: true }); } },
    "../supabase/admin": { createSupabaseAdmin: () => database(tables) },
    "../data/invoices": { getInvoice: async () => { invoiceReads++; return invoice; }, createInvoice: async () => invoice, mutateInvoice: async () => invoice },
    "../data/invoice-connections": { invoiceBootstrap: async (input: { companyId?: string; email?: string; threadId?: string }) => { bootstrapInput = input; return { document: { ...document, ...(input.threadId ? { sourceThreadId: input.threadId, customerEmail: input.email } : {}) } }; }, invoiceProducts: async () => ({ products: [{ sku: "PLA", name: "PLA Black", currency: "USD", moq: 1, priceMinor: 500, tiers: [], variants: [], stockStatus: "Available", imageUrl: null }] }), validateInvoiceConnections: async () => {} },
    "../data/invoice-banks": { invoiceBankAccounts: async () => [] },
    "../data/mailboxes": { getEffectiveMailbox: async () => null, mailboxHasSmtp: () => false },
    "../invoice-permissions": permissions,
    "../invoices": invoices,
    "./agent-actions": actions,
    "./agent-progress": progress,
    "./agent-records": { loadAgentCompany: async () => ({ ...company, fingerprint }), loadAgentEmails: async () => ({ companyId, current: { id: "mail-1", contact: "secondary@example.com", threadId: "thread-1" } }), prepareAgentEmail: async (value: unknown) => ({ ...value as object, threadId: "thread-1", inReplyTo: "<order@example.com>", references: ["<order@example.com>"] }) },
    "../email-threading": threading,
    "../invoice-pdf": { renderInvoicePdf: async () => Buffer.from("%PDF-1.7 actual-invoice") },
    "../invoice-pdf-meta": { invoicePdfFilename: () => "INV-000008.pdf" },
  };
  const execution = moduleUnderTest<typeof import("../lib/ai/agent-execution.ts")>("../lib/ai/agent-execution.ts", dependencies);
  return { ...execution, tables, savedForms, sent, dependencies, changeCustomer: () => { fingerprint = "b".repeat(64); }, invoiceReads: () => invoiceReads, bootstrapInput: () => bootstrapInput };
}

test("customer field updates preserve other profile fields and reject stale approved snapshots", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "update_company", companyId, changes: { city: "Shanghai", commerce: { shippingAddress: "New warehouse" } } }], viewer, "ask");
  assert.equal(actions.preparedAgentActionSchema.safeParse(proposal.action).success, true);
  await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.equal(fixture.savedForms[0].get("city"), "Shanghai");
  assert.equal(fixture.savedForms[0].get("summary"), "Keep existing summary");
  assert.equal(fixture.savedForms[0].get("commerce.taxId"), "VAT-OLD");
  assert.equal(fixture.savedForms[0].get("commerce.shippingAddress"), "New warehouse");
  fixture.changeCustomer();
  await assert.rejects(() => fixture.executeAgentAction(actionId, proposal.action, viewer, request), /changed after the proposal/);
  assert.equal(fixture.savedForms.length, 1);
});

test("additional customer information appends a note without replacing the summary", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "add_company_note", companyId, note: "Preferred delivery: mornings" }], viewer, "auto");
  await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.equal(fixture.savedForms[0].get("comment"), "Preferred delivery: mornings");
  assert.equal(fixture.savedForms[0].get("summary"), null);
  await assert.rejects(() => fixture.prepareAgentActions([], { ...viewer, role: "viewer" }, "auto"), /read-only/);
  assert.equal(workspaceActionSchema.safeParse({ type: "update_company", companyId, changes: { owner_id: "forged" } }).success, false);
  assert.equal(workspaceActionSchema.safeParse({ type: "update_company", companyId, changes: {} }).success, false);
});

test("invoice email drafts need no SMTP, retain verified reply headers and never send", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "send_invoice", invoiceId, email }], viewer, "auto");
  assert.equal(actions.preparedAgentActionSchema.safeParse(proposal.action).success, true);
  const result = await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.equal(fixture.sent.length, 0);
  assert.equal("draft" in result && result.draft?.invoiceId, invoiceId);
  assert.equal("draft" in result && result.draft?.inReplyTo, "<order@example.com>");
  assert.equal(result.href, `/emails?agentDraft=${actionId}`);
  await assert.rejects(() => fixture.prepareAgentActions([{ type: "send_invoice", invoiceId, email: { ...email, delivery: "send" } }], viewer, "auto"), /SMTP mailbox/);
});

test("sending an invoice attaches generated PDF bytes and keeps the original email thread", async () => {
  const fixture = executionFixture();
  fixture.dependencies["../data/mailboxes"].mailboxHasSmtp = () => true;
  const [proposal] = await fixture.prepareAgentActions([{ type: "send_invoice", invoiceId, email: { ...email, delivery: "send" } }], viewer, "ask");
  await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.equal(fixture.sent.length, 1);
  const sent = fixture.sent[0];
  assert.equal(sent.threadId, "thread-1");
  assert.equal(sent.inReplyTo, "<order@example.com>");
  const attachment = (sent.attachments as { filename: string; content: string }[])[0];
  assert.equal(attachment.filename, "INV-000008.pdf");
  assert.equal(Buffer.from(attachment.content, "base64").toString(), "%PDF-1.7 actual-invoice");
});

test("plain email draft actions work without an invoice or configured SMTP", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "write_email", email: { ...email, text: "Thanks for your enquiry." } }], viewer, "ask");
  assert.equal(actions.preparedAgentActionSchema.safeParse(proposal.action).success, true);
  const result = await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.match(result.success || "", /draft/);
  assert.equal(fixture.invoiceReads(), 0);
  assert.equal(fixture.sent.length, 0);
});

test("creating an invoice from an email links its thread and uses the actual correspondent", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "create_invoice", companyId, sourceEmailId: "mail-1", items: [{ productSku: "PLA", quantity: 200 }] }], viewer, "ask");
  assert.equal(fixture.bootstrapInput()?.email, "secondary@example.com");
  assert.equal(fixture.bootstrapInput()?.threadId, "thread-1");
  assert.equal(proposal.action.type === "create_invoice" && proposal.action.document.sourceThreadId, "thread-1");
  assert.equal(proposal.action.type === "create_invoice" && proposal.action.document.customerEmail, "secondary@example.com");
});

test("open email context loads full bodies, matches secondary contacts and derives reply headers", async () => {
  const tables = { contacts: [{ email: "buyer@example.com", company_id: companyId }] };
  const messages = [{ id: "mail-1", direction: "inbound", subject: "Order", contact: "buyer@example.com", body: "Preview only", bodyLoaded: false, uid: 4, uidValidity: 1, mailboxKey: "key", messageId: "<order@example.com>", threadId: "thread-1", timestamp: "2026-10-26T00:00:00Z" }];
  let fullReads = 0;
  const records = moduleUnderTest<typeof import("../lib/ai/agent-records.ts")>("../lib/ai/agent-records.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => database(tables) },
    "../company-commerce": commerce,
    "../email-inbox": { getEmailInboxBackendData: async () => ({ emails: messages }) },
    "../data/mailboxes": { getEffectiveMailbox: async () => ({ id: "mailbox" }) },
    "../data/mailbox-sync": { mailboxSyncKey: () => "key", loadMailboxMessageContent: async () => { fullReads++; return { body: "Please invoice 200 black PLA. Ship to the Shanghai warehouse." }; } },
    "../email-threading": threading,
  });
  const context = await records.loadAgentEmails(viewer, "mail-1");
  assert.equal(context.companyId, companyId);
  assert.match(context.current?.body || "", /200 black PLA/);
  assert.equal(fullReads, 1);
  const prepared = await records.prepareAgentEmail(email, viewer);
  assert.equal("inReplyTo" in prepared && prepared.inReplyTo, "<order@example.com>");
  await assert.rejects(() => records.prepareAgentEmail({ ...email, to: "other@example.com" }, viewer), /conversation's recipient/);
  await assert.rejects(() => records.loadAgentEmails(viewer, "not-accessible"), /no longer have access/);
  tables.contacts.push({ email: "buyer@example.com", company_id: invoiceId });
  assert.equal((await records.loadAgentEmails(viewer, "mail-1")).companyId, null);
});

test("invoices carry email billing and shipping details while prices remain server-controlled", () => {
  const action = workspaceActionSchema.parse({ type: "create_invoice", companyId, items: [{ productSku: "PLA", quantity: 200 }], details: { customerAddress: "Billing office", shippingRecipient: "Alex", shippingAddress: "Shanghai warehouse", reference: "PO-123" } });
  assert.equal(action.type, "create_invoice");
  if (action.type !== "create_invoice") return;
  const built = actions.buildAgentInvoice(document, action, [{ sku: "PLA", name: "PLA Black", currency: "USD", moq: 1, priceMinor: 500, tiers: [], variants: [], stockStatus: "Available", imageUrl: null }], []);
  assert.equal(built.shippingAddress, "Shanghai warehouse");
  assert.equal(built.reference, "PO-123");
  assert.equal(built.items[0].unitPriceMinor, 500);
  assert.equal(workspaceActionSchema.safeParse({ ...action, details: { unitPriceMinor: 1 } }).success, false);
});

test("open email scope overrides an old company and does not reuse another customer's invoice", async () => {
  let bootstrapCompany: string | undefined;
  let matchedCompany: string | null = companyId;
  const oldCompany = "a37acc59-4a11-47db-ad1e-aa9fe5d72e74";
  const context = moduleUnderTest<typeof import("../lib/ai/agent-context.ts")>("../lib/ai/agent-context.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => database({ workspace_agent_actions: [{ id: actionId, user_id: viewer.id, status: "completed", result: { invoiceId } }], products: [], companies: [] }) },
    "../data/invoice-connections": { invoiceBootstrap: async ({ companyId }: { companyId?: string }) => { bootstrapCompany = companyId; return { document, billing: {} }; }, invoiceCustomers: async () => ({ customers: [], count: 0 }), invoiceProductSelect: "sku,name" },
    "../data/invoice-banks": { invoiceBankAccounts: async () => [] },
    "../data/invoices": { getInvoice: async () => ({ ...invoice, document: { ...document, companyId: oldCompany } }) },
    "../data/mailboxes": { getEffectiveMailbox: async () => null, mailboxHasSmtp: () => false },
    "../invoice-links": { invoiceProduct: (value: unknown) => value },
    "../email-threading": threading,
    "./agent-records": { loadAgentEmails: async () => ({ current: { id: "mail-1", body: "Please invoice PLA Black" }, messages: [{ subject: "Order", body: "Please invoice PLA Black" }], companyId: matchedCompany }), loadAgentCompany: async (id: string) => ({ id }), presentAgentEmail: (value: unknown) => value },
  });
  const input = { language: "en", mode: "work", approvalMode: "ask", completedActionIds: [actionId], pageContext: { companyId: oldCompany, emailId: "mail-1" }, pathname: "/emails", pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "Create an invoice from this email" }] } as const;
  const result = await context.loadAgentContext({ ...input, completedActionIds: [...input.completedActionIds], messages: [...input.messages] }, viewer);
  assert.equal(result.currentCompanyId, companyId);
  assert.equal(result.currentInvoice, null);
  assert.equal(bootstrapCompany, companyId);
  matchedCompany = null;
  const unmatched = await context.loadAgentContext({ ...input, completedActionIds: [...input.completedActionIds], messages: [...input.messages] }, viewer);
  assert.equal(unmatched.currentCompanyId, null);
  assert.equal(unmatched.currentInvoice, null);
});

test("draft retrieval checks ownership, completed state, source access and invoice revision", async () => {
  const tables: Record<string, Record<string, unknown>[]> = { workspace_agent_actions: [{ id: actionId, user_id: viewer.id, status: "completed", result: { draft: { ...email, invoiceId, revision: 1 } } }] };
  let revision = 1;
  let allowed = true;
  const route = moduleUnderTest<typeof import("../app/api/ai/assistant/draft/route.ts")>("../app/api/ai/assistant/draft/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => database(tables) },
    "@/lib/ai/agent-actions": actions,
    "@/lib/ai/agent-records": { prepareAgentEmail: async () => { if (!allowed) throw new Error("Source email access revoked."); } },
    "@/lib/data/invoices": { getInvoice: async () => ({ ...invoice, revision }) },
  });
  const request = new Request(`http://localhost:3000/api/ai/assistant/draft?id=${actionId}`);
  assert.equal((await route.GET(request)).status, 200);
  revision = 2;
  assert.equal((await route.GET(request)).status, 409);
  revision = 1;
  allowed = false;
  assert.equal((await route.GET(request)).status, 409);
  allowed = true;
  tables.workspace_agent_actions[0].user_id = "another-user";
  assert.equal((await route.GET(request)).status, 404);
  tables.workspace_agent_actions[0].user_id = viewer.id;
  tables.workspace_agent_actions[0].status = "pending";
  assert.equal((await route.GET(request)).status, 404);
});
