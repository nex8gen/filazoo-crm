import { policyTestDependency } from "./helpers/ai-policy.ts";
import * as replyTools from "../lib/ai/crm-reply-tools.ts";
import * as readiness from "../lib/ai/invoice-readiness.ts";
import test from "node:test";
import { personalProductService } from "./helpers/personal-products.ts";
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
import * as flows from "../lib/flows.ts";
import * as crmTools from "../lib/ai/crm-tools.ts";
import * as profileFields from "../lib/company-profile-fields.ts";
import type { InvoicePaymentMethod } from "../lib/invoice-payment-methods.ts";
import { workspaceActionSchema } from "../lib/ai/workspace-assistant.ts";
import { buildInboxEmailItems } from "../lib/email-inbox.ts";

const require = createRequire(import.meta.url);
function moduleUnderTest<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => policyTestDependency(name) ?? (name === "server-only" ? {} : dependencies[name] ?? (name === "./crm-reply-tools" ? replyTools : name === "./crm-reply-execution" ? { replyOperationTarget: () => { throw new Error("Reply workflows use their dedicated fixtures"); } } : name === "../data/customer-reply-requests" ? { listReplyRequests: async () => [] } : name === "@/lib/ai/invoice-readiness" ? readiness : undefined) ?? require(name)), Response, Request, URL, FormData, Date, Error, crypto, console, Buffer, Intl });
  return exports as T;
}

function database(tables: Record<string, Record<string, unknown>[]>) {
  return { from(table: string) {
    let inserted: Record<string, unknown>[] | undefined;
    let updated: Record<string, unknown> | undefined;
    const filters = new Map<string, unknown>();
    const lists = new Map<string, unknown[]>();
    const run = () => {
      if (inserted) (tables[table] ??= []).push(...inserted);
      const data = (tables[table] ?? []).filter((row) => [...filters].every(([key, value]) => row[key] === value) && [...lists].every(([key, values]) => values.includes(row[key])));
      if (updated) data.forEach((row) => Object.assign(row, updated));
      return { data, error: null, count: data.length };
    };
    const query = {
      select() { return query; }, order() { return query; }, limit() { return query; }, not() { return query; }, or() { return query; },
      eq(key: string, value: unknown) { filters.set(key, value); return query; },
      in(key: string, values: unknown[]) { lists.set(key, values); return query; },
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
  const savedPatches: profileFields.CompanyProfileChanges[] = [];
  const sent: Record<string, unknown>[] = [];
  const savedFlows: { userId: string; input: flows.FlowInput }[] = [];
  const savedInvoices: invoices.InvoiceDocument[] = [];
  const payments: InvoicePaymentMethod[] = [{ id: "3280fd30-4529-4c4d-ab74-c695ab064e57", type: "paypal", label: "PayPal", currency: "", details: "PayPal payment", paymentUrl: "https://paypal.me/example" }];
  let fingerprint = "a".repeat(64);
  let invoiceReads = 0;
  let bootstrapInput: { companyId?: string; email?: string; threadId?: string } | undefined;
  const company = { id: companyId, fields: { name: "Acme", city: "Old city", summary: "Keep existing summary", contactEmail: "buyer@example.com", "commerce.address": "Saved address", "commerce.taxId": "VAT-OLD" }, contacts: [], fingerprint };
  const dependencies = {
    "./crm-execution": {},
    "./crm-tools": crmTools,
    "./agent-catalog": { prepareAgentCatalog: async (email: unknown) => email, agentCatalogAttachments: (async () => []) as (email: unknown) => Promise<{ filename: string; contentType: string; content: string; size: number }[]> },
    "../company-profile-fields": profileFields,
    "next/cache": { revalidatePath() {} },
    "@/app/crm-actions": { createCompany() {}, updateCompanyFields: async (_id: string, changes: profileFields.CompanyProfileChanges) => { savedPatches.push(changes); return { success: "Customer updated." }; }, addCompanyComment: async (_id: string, _state: unknown, form: FormData) => { savedForms.push(form); return { success: "Note added." }; } },
    "@/app/api/email/send/route": { POST: async (request: Request) => { sent.push(await request.json()); return Response.json({ ok: true, saved: true }); } },
    "../supabase/admin": { createSupabaseAdmin: () => database(tables) },
    "../data/invoices": { getInvoice: async () => { invoiceReads++; return invoice; }, createInvoice: async (value: invoices.InvoiceDocument) => { savedInvoices.push(value); return { ...invoice, document: value }; }, mutateInvoice: async (_id: string, _userId: string, value: { document: invoices.InvoiceDocument }) => { savedInvoices.push(value.document); return { ...invoice, document: value.document }; } },
    "../data/invoice-connections": { invoiceBootstrap: async (input: { companyId?: string; email?: string; threadId?: string }) => { bootstrapInput = input; return { document: { ...document, ...(input.threadId ? { sourceThreadId: input.threadId, customerEmail: input.email } : {}) } }; }, invoiceProducts: async () => ({ products: [{ sku: "PLA", name: "PLA Black", currency: "USD", moq: 1, priceMinor: 500, tiers: [], variants: [], stockStatus: "Available", imageUrl: null }] }), validateInvoiceConnections: async () => {} },
    "../data/invoice-banks": { invoiceBankAccounts: async () => [] },
    "../data/invoice-payment-methods": { invoicePaymentMethods: async () => payments },
    "../data/flows": { createFlow: async (userId: string, input: flows.FlowInput) => { savedFlows.push({ userId, input }); return { id: invoiceId, ...input }; } },
    "../flows": flows,
    "../data/mailboxes": { getViewerMailboxes: async () => [], getEffectiveMailbox: async () => null, mailboxHasSmtp: () => false },
    "../invoice-permissions": permissions,
    "../invoices": invoices,
    "./agent-actions": actions,
    "./agent-progress": progress,
    "./agent-records": { loadAgentCompany: async () => ({ ...company, fingerprint }), loadAgentEmails: async () => ({ companyId, current: { id: "mail-1", direction: "inbound", contact: "secondary@example.com", threadId: "thread-1" } }), prepareAgentEmail: async (value: unknown) => ({ ...value as object, threadId: "thread-1", inReplyTo: "<order@example.com>", references: ["<order@example.com>"] }) },
    "../email-threading": threading,
    "../invoice-pdf": { renderInvoicePdf: async () => Buffer.from("%PDF-1.7 actual-invoice") },
    "../invoice-pdf-meta": { invoicePdfFilename: () => "INV-000008.pdf" },
  };
  const execution = moduleUnderTest<typeof import("../lib/ai/agent-execution.ts")>("../lib/ai/agent-execution.ts", dependencies);
  return { ...execution, tables, savedForms, savedPatches, savedFlows, savedInvoices, payments, sent, dependencies, changeCustomer: () => { fingerprint = "b".repeat(64); }, invoiceReads: () => invoiceReads, bootstrapInput: () => bootstrapInput };
}

test("preparation grounds explicit variant colors in the actual catalog before saving any review card", async () => {
  const f = executionFixture();
  Object.assign(f.dependencies["../data/invoice-connections"], { invoiceProducts: async () => ({ products: [{ sku: "SILK", name: "Silk PLA", currency: "USD", moq: 1, priceMinor: 500, tiers: [], stockStatus: "Available", imageUrl: null, variants: [
    { id: "red-gold", name: "Red Gold", sku: "SILK-01", priceMinor: 566, stockStatus: "Available" }, { id: "black-gold", name: "Black Gold", sku: "SILK-02", priceMinor: 650, stockStatus: "Available" },
  ] }] }) });
  const input = { type: "create_invoice" as const, companyId, items: [{ productSku: "SILK", variantId: "red-gold", quantity: 100 }] };
  const [proposal] = await f.prepareAgentActions([input], viewer, "ask", { messages: [{ role: "user", content: "100 PLA silk black and gold pieces" }] });
  assert.equal(proposal.action.type, "create_invoice");
  if (proposal.action.type !== "create_invoice") throw new Error("Expected draft invoice");
  assert.equal(proposal.action.document.items[0].variantId, "black-gold"); assert.equal(proposal.action.document.items[0].unitPriceMinor, 650);
  assert.equal(f.savedInvoices.length, 0); assert.equal(f.sent.length, 0);
  const count = f.tables.workspace_agent_actions.length;
  await assert.rejects(() => f.prepareAgentActions([input], viewer, "auto", { messages: [{ role: "user", content: "100 PLA purple gold pieces" }] }), /Which saved variant/);
  assert.equal(f.tables.workspace_agent_actions.length, count, "A missing variant must not create even an auto-approved proposal");
});

test("company creation returns its verified saved ID for dependent actions and never invents a success", async () => {
  const f = executionFixture();
  const action = workspaceActionSchema.parse({ type: "create_company", company: { name: "Audit", country: "US", segment: "Test" } });
  const [proposal] = await f.prepareAgentActions([action], viewer, "ask");
  Object.assign(f.dependencies["@/app/crm-actions"], { createCompany: async () => ({ success: "Audit was added.", companyId }) });
  const result = await f.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.equal(result.companyId, companyId);
  assert.equal(result.href, `/companies/${companyId}`);
  Object.assign(f.dependencies["@/app/crm-actions"], { createCompany: async () => undefined });
  await assert.rejects(() => f.executeAgentAction(actionId, proposal.action, viewer, request), /did not confirm/);
});

test("customer field updates preserve other profile fields and reject stale approved snapshots", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "update_company", companyId, changes: { city: "Shanghai", commerce: { shippingAddress: "New warehouse" } } }], viewer, "ask");
  assert.equal(actions.preparedAgentActionSchema.safeParse(proposal.action).success, true);
  await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.deepEqual(fixture.savedPatches[0], { city: "Shanghai", commerce: { shippingAddress: "New warehouse" } });
  assert.equal(fixture.savedPatches[0].summary, undefined);
  assert.equal(fixture.savedPatches[0].commerce?.taxId, undefined);
  fixture.changeCustomer();
  await assert.rejects(() => fixture.executeAgentAction(actionId, proposal.action, viewer, request), /changed after the proposal/);
  assert.equal(fixture.savedPatches.length, 1);
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

test("country derivation is included in the proposal before approval and is opt-in per request", async () => {
  const fixture = executionFixture();
  const changes = { commerce: { shippingAddress: "1 Dixon Ln, Tarrytown, NY 10591, United States", shippingRecipient: "Jimmy Przybylinski" } };
  const [derived] = await fixture.prepareAgentActions([{ type: "update_company", companyId, changes, deriveAddressFields: true }], viewer, "ask");
  assert.equal(derived.action.type, "update_company");
  if (derived.action.type !== "update_company") throw new Error("Expected a profile update.");
  assert.equal(derived.action.changes.country, "United States");
  await fixture.executeAgentAction(actionId, derived.action, viewer, request);
  assert.equal(fixture.savedPatches[0].country, "United States");
  const [shippingOnly] = await fixture.prepareAgentActions([{ type: "update_company", companyId, changes }], viewer, "ask");
  if (shippingOnly.action.type !== "update_company") throw new Error("Expected a profile update.");
  assert.equal(shippingOnly.action.changes.country, undefined);
});

test("email-based profile updates recheck exact customer matching and source access before writing", async () => {
  const fixture = executionFixture();
  const action = workspaceActionSchema.parse({ type: "update_company", companyId, sourceEmailId: "mail-1", changes: { commerce: { shippingAddress: "99 New Road, Shanghai 200000, China", shippingRecipient: "Alex" } } });
  const [proposal] = await fixture.prepareAgentActions([action], viewer, "auto");
  assert.equal(actions.preparedAgentActionSchema.safeParse(proposal.action).success, true);
  await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.equal(fixture.savedPatches[0].commerce?.shippingAddress, "99 New Road, Shanghai 200000, China");
  assert.equal(fixture.savedPatches[0].commerce?.address, undefined);
  assert.equal(fixture.savedPatches[0].contactEmail, undefined);
  fixture.dependencies["./agent-records"].loadAgentEmails = async () => { throw new Error("Source access revoked."); };
  await assert.rejects(() => fixture.executeAgentAction(actionId, proposal.action, viewer, request), /access revoked/);
  assert.equal(fixture.savedPatches.length, 1);
  for (const mismatch of [null, invoiceId, companyId]) {
    fixture.dependencies["./agent-records"].loadAgentEmails = async () => ({ companyId: mismatch as string, current: { id: "mail-1", direction: mismatch === companyId ? "outbound" : "inbound", contact: "secondary@example.com", threadId: "thread-1" } });
    await assert.rejects(() => fixture.prepareAgentActions([action], viewer, "ask"), /does not uniquely match/);
    await assert.rejects(() => fixture.executeAgentAction(actionId, proposal.action, viewer, request), /does not uniquely match/);
  }
  assert.equal(fixture.savedPatches.length, 1);
});

test("email lookup loads full accessible inbound bodies, matches secondary contacts, and reports incomplete coverage", async () => {
  const tables = {
    contacts: [{ email: "secondary@example.com", company_id: companyId }, { email: "shared@example.com", company_id: companyId }, { email: "shared@example.com", company_id: invoiceId }],
    companies: [{ id: companyId, name: "Acme" }],
  };
  const base = { direction: "inbound", company: "Acme", companyId, subject: "Shipping", contact: "secondary@example.com", body: "Ship to 99 New Road", timestamp: "2026-10-27T00:00:00Z" };
  const messages = [
    { ...base, id: "full", bodyLoaded: false, uid: 1, uidValidity: 1, mailboxKey: "key" },
    { ...base, id: "unavailable", bodyLoaded: false, uid: 2, uidValidity: 1, mailboxKey: "key" },
    { ...base, id: "ambiguous", contact: "shared@example.com" },
    ...Array.from({ length: 7 }, (_, index) => ({ ...base, id: `recent-${index}` })),
    { ...base, id: "demo", demo: true }, { ...base, id: "outbound", direction: "outbound" },
    { ...base, id: "other-customer", companyId: invoiceId, contact: "other@example.com", bodyLoaded: false },
  ];
  let reads = 0;
  const records = moduleUnderTest<typeof import("../lib/ai/agent-records.ts")>("../lib/ai/agent-records.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => database(tables) }, "../company-commerce": commerce,
    "../email-inbox": { getEmailInboxBackendData: async (options: { syncMailbox: boolean; history: boolean }) => { assert.equal(options.syncMailbox, false); assert.equal(options.history, true); return { emails: messages, inboxError: "Some mailbox history unavailable" }; } },
    "../data/mailboxes": { getViewerMailboxes: async () => [{ id: "mailbox" }], getEffectiveMailbox: async () => ({ id: "mailbox" }) },
    "../data/mailbox-sync": { mailboxSyncKey: () => "key", loadMailboxMessageContent: async (_mailbox: unknown, uid: number) => { reads++; if (uid === 2) throw new Error("Body unavailable"); return { body: "Ship to 99 New Road, Shanghai 200000, China" }; } },
    "../email-threading": threading,
  });
  const result = await records.searchAgentEmails(viewer, { companyId, query: "", offset: 0 });
  assert.equal(result.coverage.matching, 10);
  assert.equal(result.coverage.unloadedBodiesNotSearched, 2, "Other customers' unloaded bodies do not make this customer search incomplete");
  assert.equal(result.coverage.included, 8);
  assert.equal(result.coverage.nextOffset, 8);
  assert.match(result.coverage.mailboxError || "", /history unavailable/);
  assert.equal(result.messages.find((message) => message.id === "full")?.text, "Ship to 99 New Road, Shanghai 200000, China");
  assert.equal(result.messages.find((message) => message.id === "full")?.companyId, companyId);
  assert.equal(result.messages.find((message) => message.id === "ambiguous")?.companyId, null);
  assert.equal(result.messages.find((message) => message.id === "unavailable")?.contentAvailable, false);
  assert.equal(result.messages.find((message) => message.id === "unavailable")?.text, "");
  assert.equal(result.companies.length, 1);
  assert.equal(reads, 2);
  const next = await records.searchAgentEmails(viewer, { companyId, query: "", offset: 8 });
  assert.equal(next.messages.length, 2);
  assert.equal(next.coverage.nextOffset, null);
  const empty = await records.searchAgentEmails(viewer, { query: "unknown@example.com", offset: 0 });
  assert.equal(empty.messages.length, 0);
  await assert.rejects(() => records.searchAgentEmails(viewer, { query: "", offset: 0, emailId: "private-message" }), /unavailable/);
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

test("catalog drafts retain approved product snapshots and sends include real catalog bytes alongside invoices", async () => {
  const fixture = executionFixture();
  const snapshot = { productSkus: ["PLA"], fingerprint: "a".repeat(64) };
  const attachment = { filename: "Filazoo-product-catalog.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.7 catalog").toString("base64"), size: 16 };
  let rendered = 0;
  Object.assign(fixture.dependencies["./agent-catalog"], {
    prepareAgentCatalog: async (value: unknown) => ({ ...value as object, catalogSnapshot: snapshot }),
    agentCatalogAttachments: async (...values: unknown[]) => {
      assert.equal((values[0] as { attachCatalog: boolean }).attachCatalog, true);
      assert.deepEqual((values[0] as { catalogSnapshot: unknown }).catalogSnapshot, snapshot);
      rendered++;
      return [attachment];
    },
  });
  const catalogEmail = { ...email, attachCatalog: true, text: "The catalog is attached." };
  const [draft] = await fixture.prepareAgentActions([{ type: "write_email", email: catalogEmail }], viewer, "ask");
  assert.equal(actions.preparedAgentActionSchema.safeParse(draft.action).success, true);
  const result = await fixture.executeAgentAction(actionId, draft.action, viewer, request);
  assert.match(result.success || "", /catalog PDF/);
  assert.equal("draft" in result && result.draft?.attachCatalog, true);
  assert.deepEqual("draft" in result && result.draft?.catalogSnapshot, snapshot);
  assert.equal(fixture.sent.length, 0);
  assert.equal(rendered, 1);

  fixture.dependencies["../data/mailboxes"].mailboxHasSmtp = () => true;
  for (const action of [
    { type: "write_email" as const, email: { ...catalogEmail, delivery: "send" as const } },
    { type: "send_invoice" as const, invoiceId, email: { ...catalogEmail, delivery: "send" as const } },
  ]) {
    const [proposal] = await fixture.prepareAgentActions([action], viewer, "ask");
    await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
    const sent = fixture.sent.at(-1)!;
    assert.equal(sent.inReplyTo, "<order@example.com>");
    const attachments = sent.attachments as { filename: string; content: string }[];
    assert.equal(attachments.length, action.type === "send_invoice" ? 2 : 1);
    const catalog = attachments.find((item) => item.filename === attachment.filename)!;
    assert.equal(Buffer.from(catalog.content, "base64").toString(), "%PDF-1.7 catalog");
  }
});

test("catalog PDF failures stop execution before email sending or invoice creation", async () => {
  const fixture = executionFixture();
  fixture.dependencies["./agent-catalog"].agentCatalogAttachments = async () => { throw new Error("Catalog changed after approval."); };
  for (const action of [
    { type: "write_email" as const, email: { ...email, attachCatalog: true } },
    { type: "create_invoice" as const, companyId, items: [{ productSku: "PLA", quantity: 200 }], email: { ...email, attachCatalog: true } },
  ]) {
    const [proposal] = await fixture.prepareAgentActions([action], viewer, "ask");
    await assert.rejects(() => fixture.executeAgentAction(actionId, proposal.action, viewer, request), /Catalog changed/);
  }
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.savedInvoices.length, 0);
});

test("creating an invoice from an email links its thread and uses the actual correspondent", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "create_invoice", companyId, sourceEmailId: "mail-1", items: [{ productSku: "PLA", quantity: 200 }] }], viewer, "ask");
  assert.equal(fixture.bootstrapInput()?.email, "secondary@example.com");
  assert.equal(fixture.bootstrapInput()?.threadId, "thread-1");
  assert.equal(proposal.action.type === "create_invoice" && proposal.action.document.sourceThreadId, "thread-1");
  assert.equal(proposal.action.type === "create_invoice" && proposal.action.document.customerEmail, "secondary@example.com");
});

test("shipping-only changes save the charge and preserve custom invoice lines", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "update_invoice", invoiceId, companyId, details: { shippingMinor: 3900 } }], viewer, "ask");
  assert.equal(fixture.savedInvoices.length, 0);
  await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.equal(fixture.savedInvoices[0].shippingMinor, 3900);
  assert.deepEqual(fixture.savedInvoices[0].items, document.items);
  assert.equal(invoices.invoiceTotals(fixture.savedInvoices[0]).total, 103900);
  assert.equal(fixture.sent.length, 0);
});

test("current payment methods reach the saved invoice and changed approved payment details block saving", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "create_invoice", companyId, items: [{ productSku: "PLA", quantity: 200 }], details: { shippingMinor: 3900 } }], viewer, "ask");
  assert.equal(actions.preparedAgentActionSchema.safeParse(proposal.action).success, true);
  fixture.payments[0] = { ...fixture.payments[0], paymentUrl: "https://paypal.me/changed" };
  await assert.rejects(() => fixture.executeAgentAction(actionId, proposal.action, viewer, request), /payment details changed/);
  assert.equal(fixture.savedInvoices.length, 0);
  const [fresh] = await fixture.prepareAgentActions([{ type: "create_invoice", companyId, items: [{ productSku: "PLA", quantity: 200 }], details: { shippingMinor: 3900 } }], viewer, "ask");
  await fixture.executeAgentAction(actionId, fresh.action, viewer, request);
  assert.deepEqual(fixture.savedInvoices[0].paymentMethods, fixture.payments);
  assert.equal(fixture.savedInvoices[0].shippingMinor, 3900);
});

test("flow creation is saved for approval and execution uses the current user's CRM flow service", async () => {
  const fixture = executionFixture();
  const [proposal] = await fixture.prepareAgentActions([{ type: "create_flow", flow: flows.defaultFlowInput }], viewer, "ask");
  assert.equal(actions.preparedAgentActionSchema.safeParse(proposal.action).success, true);
  assert.equal(fixture.tables.workspace_agent_actions.length, 2);
  assert.equal(fixture.savedFlows.length, 0);
  assert.equal(progress.actionWorkProgress(proposal.action).area, "flow");
  const result = await fixture.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.equal(fixture.savedFlows[0].userId, viewer.id);
  assert.equal(fixture.savedFlows[0].input.status, "draft");
  assert.deepEqual(fixture.savedFlows[0].input.steps, flows.defaultFlowInput.steps);
  assert.equal(result.href, `/lead-channel/ai-agent?flow=${invoiceId}`);
  assert.equal(fixture.savedInvoices.length, 0);
  assert.equal(fixture.sent.length, 0);
  await assert.rejects(() => fixture.prepareAgentActions([{ type: "create_flow", flow: flows.defaultFlowInput }], { ...viewer, role: "viewer" }, "ask"), /read-only/);
});

test("live flow creation propagates resource validation failures", async () => {
  const fixture = executionFixture();
  fixture.dependencies["../data/flows"].createFlow = async () => { throw new Error("The selected sender mailbox needs complete SMTP settings."); };
  const [proposal] = await fixture.prepareAgentActions([{ type: "create_flow", flow: { ...flows.defaultFlowInput, status: "live" } }], viewer, "ask");
  await assert.rejects(() => fixture.executeAgentAction(actionId, proposal.action, viewer, request), /SMTP settings/);
  assert.equal(fixture.savedFlows.length, 0);
  assert.equal(fixture.sent.length, 0);
});

test("open email context loads full bodies, matches secondary contacts and derives reply headers", async () => {
  const tables = { contacts: [{ email: "buyer@example.com", company_id: companyId }] };
  const messages = [{ id: "mail-1", direction: "inbound", subject: "Order", contact: "buyer@example.com", body: "Preview only", bodyLoaded: false, uid: 4, uidValidity: 1, mailboxKey: "key", messageId: "<order@example.com>", threadId: "thread-1", timestamp: "2026-10-26T00:00:00Z" }];
  let fullReads = 0;
  const records = moduleUnderTest<typeof import("../lib/ai/agent-records.ts")>("../lib/ai/agent-records.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => database(tables) },
    "../company-commerce": commerce,
    "../email-inbox": { getEmailInboxBackendData: async () => ({ emails: messages }) },
    "../data/mailboxes": { getViewerMailboxes: async () => [], getEffectiveMailbox: async () => ({ id: "mailbox" }) },
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

test("the agent accepts real enquiries produced by the inbox builder and still rejects demo emails", async () => {
  const messages = buildInboxEmailItems({ inbound: [
    { id: "shopify-1", source: "shopify", contact: "buyer@example.com", company: "Example Print Studio", body: "Please create a company profile.", timestamp: "2026-10-26T00:00:00Z" },
    { id: "mailbox-1", source: "mailbox", contact: "buyer@example.com", body: "Our company details", timestamp: "2026-10-25T00:00:00Z" },
    { id: "sample-1", demo: true, contact: "buyer@example.com", body: "Sample company", timestamp: "2026-10-24T00:00:00Z" },
  ] });
  const records = moduleUnderTest<typeof import("../lib/ai/agent-records.ts")>("../lib/ai/agent-records.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => database({ contacts: [{ email: "buyer@example.com", company_id: companyId }] }) },
    "../company-commerce": commerce,
    "../email-inbox": { getEmailInboxBackendData: async () => ({ emails: messages }) },
    "../data/mailboxes": { getViewerMailboxes: async () => [], getEffectiveMailbox: async () => null },
    "../data/mailbox-sync": {},
    "../email-threading": threading,
  });
  for (const emailId of ["shopify-1", "mailbox-1"]) {
    const context = await records.loadAgentEmails(viewer, emailId);
    assert.equal(context.current?.id, emailId);
    assert.equal(context.companyId, companyId);
  }
  await assert.rejects(() => records.loadAgentEmails(viewer, "sample-1"), /no longer have access/);
  const history = await records.loadAgentEmails(viewer, undefined, companyId);
  assert.equal(history.messages.some((message) => message.demo), false);
  assert.equal(history.messages.length, 2);
});

test("selected workspace mailbox emails remain accessible at preparation and do not use the personal mailbox for bodies", async () => {
  const personalId = "a37acc59-4a11-47db-ad1e-aa9fe5d72e74";
  const requests: string[] = [];
  const source = { id: "workspace-mail", direction: "inbound", contact: "buyer@example.com", subject: "PLA", body: "Preview", bodyLoaded: false, uid: 7, uidValidity: 2, mailboxKey: "workspace-key", threadId: "thread", timestamp: "2026-10-28T00:00:00Z", messageId: "<workspace@example.com>" };
  const records = moduleUnderTest<typeof import("../lib/ai/agent-records.ts")>("../lib/ai/agent-records.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => database({ contacts: [] }) }, "../company-commerce": commerce, "../email-threading": threading,
    "../email-inbox": { getEmailInboxBackendData: async (options: { mailboxId?: string }) => { requests.push(options.mailboxId ?? "default"); return { selectedMailboxId: options.mailboxId ?? personalId, emails: options.mailboxId === invoiceId ? [source] : [] }; } },
    "../data/mailboxes": { getViewerMailboxes: async () => [{ id: personalId }, { id: invoiceId }], getViewerMailbox: async (_viewerId: string, id: string) => ({ id }), getEffectiveMailbox: async () => { throw new Error("Must not use the default sender to read a workspace body"); } },
    "../data/mailbox-sync": { mailboxSyncKey: (mailbox: { id: string }) => mailbox.id === invoiceId ? "workspace-key" : "personal-key", loadMailboxMessageContent: async (mailbox: { id: string }) => { assert.equal(mailbox.id, invoiceId); return { body: "Please quote 500 kg PLA" }; } },
  });
  const selected = await records.loadAgentEmails(viewer, source.id, undefined, invoiceId);
  assert.equal(selected.current?.body, "Please quote 500 kg PLA");
  assert.deepEqual(requests, [invoiceId]);
  requests.length = 0;
  const prepared = await records.prepareAgentEmail({ ...email, sourceEmailId: source.id }, viewer);
  assert.equal("mailboxId" in prepared && prepared.mailboxId, invoiceId);
  assert.deepEqual(requests, ["default", invoiceId]);
  await assert.rejects(() => records.loadAgentEmails(viewer, "inaccessible"), /no longer have access/);
});

test("an unavailable older email does not block the loaded selected message or expose a preview as full text", async () => {
  const selected = { id: "current", direction: "inbound", contact: "buyer@example.com", subject: "PLA", body: "Please quote PLA", threadId: "thread", timestamp: "2026-10-28T00:00:00Z" };
  const records = moduleUnderTest<typeof import("../lib/ai/agent-records.ts")>("../lib/ai/agent-records.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => database({ contacts: [] }) }, "../company-commerce": commerce, "../email-threading": threading,
    "../email-inbox": { getEmailInboxBackendData: async () => ({ emails: [{ ...selected, id: "older", bodyLoaded: false, body: "Partial preview", timestamp: "2026-10-27T00:00:00Z" }, selected] }) },
    "../data/mailboxes": { getEffectiveMailbox: async () => null }, "../data/mailbox-sync": {},
  });
  const context = await records.loadAgentEmails(viewer, "current");
  assert.equal(context.current?.body, "Please quote PLA");
  const older = records.presentAgentEmail(context.messages.find((message) => message.id === "older")!);
  assert.equal(older.contentAvailable, false);
  assert.equal(older.text, "");
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
  let supportingFailure = false;
  const oldCompany = "a37acc59-4a11-47db-ad1e-aa9fe5d72e74";
  const context = moduleUnderTest<typeof import("../lib/ai/agent-context.ts")>("../lib/ai/agent-context.ts", {
    "./agent-page-records": {},
    "../supabase/admin": { createSupabaseAdmin: () => database({ workspace_agent_actions: [{ id: actionId, user_id: viewer.id, status: "completed", result: { invoiceId } }], products: [], companies: [] }) },
    "../data/product-personalization": personalProductService({ products: [] }),
    "../data/invoice-connections": { invoiceBootstrap: async ({ companyId }: { companyId?: string }) => { if (supportingFailure) throw new Error("Billing unavailable"); bootstrapCompany = companyId; return { document, billing: {} }; }, invoiceCustomers: async () => ({ customers: [], count: 0 }), invoiceProductSelect: "sku,name" },
    "../data/invoice-banks": { invoiceBankAccounts: async () => [] },
    "../data/invoice-payment-methods": { invoicePaymentMethods: async () => [] },
    "../flows": flows,
    "../data/invoices": { getInvoice: async () => ({ ...invoice, document: { ...document, companyId: oldCompany } }) },
    "../data/mailboxes": { getViewerMailboxes: async () => [], getEffectiveMailbox: async () => null, mailboxHasSmtp: () => false },
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
  supportingFailure = true;
  const partial = await context.loadAgentContext({ ...input, completedActionIds: [...input.completedActionIds], messages: [...input.messages] }, viewer);
  assert.equal(partial.currentEmail?.id, "mail-1");
  assert.equal(partial.invoiceDefaults, null);
  assert.match(partial.contextWarnings.join(" "), /Invoice defaults unavailable/);
});

test("draft retrieval checks ownership, completed state, source access and invoice revision", async () => {
  const tables: Record<string, Record<string, unknown>[]> = { workspace_agent_actions: [{ id: actionId, user_id: viewer.id, status: "completed", result: { draft: { ...email, invoiceId, revision: 1 } } }] };
  let revision = 1;
  let allowed = true;
  const route = moduleUnderTest<typeof import("../app/api/ai/assistant/draft/route.ts")>("../app/api/ai/assistant/draft/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => database(tables) },
    "@/lib/ai/agent-actions": actions,
    "@/lib/ai/agent-catalog": { agentCatalogAttachments: async () => [] },
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

test("catalog draft retrieval returns PDF data only after owner and source access checks", async () => {
  const snapshot = { productSkus: ["PLA"], fingerprint: "a".repeat(64) };
  const draft = { ...email, attachCatalog: true, catalogSnapshot: snapshot };
  const tables: Record<string, Record<string, unknown>[]> = { workspace_agent_actions: [{ id: actionId, user_id: viewer.id, status: "completed", result: { draft } }] };
  let renderCount = 0;
  let sourceAllowed = true;
  let stale = false;
  const attachment = { filename: "Filazoo-product-catalog.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.7 catalog").toString("base64"), size: 16 };
  const route = moduleUnderTest<typeof import("../app/api/ai/assistant/draft/route.ts")>("../app/api/ai/assistant/draft/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => database(tables) },
    "@/lib/ai/agent-actions": actions,
    "@/lib/ai/agent-records": { prepareAgentEmail: async () => { if (!sourceAllowed) throw new Error("Source access revoked."); } },
    "@/lib/ai/agent-catalog": { agentCatalogAttachments: async (value: unknown) => {
      assert.equal((value as { attachCatalog: boolean }).attachCatalog, true);
      if (stale) throw new Error("Catalog changed after approval.");
      renderCount++;
      return [attachment];
    } },
    "@/lib/data/invoices": {},
  });
  const request = new Request(`http://localhost:3000/api/ai/assistant/draft?id=${actionId}`);
  const response = await route.GET(request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(Buffer.from(body.draft.attachments[0].content, "base64").toString(), "%PDF-1.7 catalog");
  assert.equal(renderCount, 1);
  tables.workspace_agent_actions[0].user_id = "another-user";
  assert.equal((await route.GET(request)).status, 404);
  assert.equal(renderCount, 1);
  tables.workspace_agent_actions[0].user_id = viewer.id;
  sourceAllowed = false;
  assert.equal((await route.GET(request)).status, 409);
  assert.equal(renderCount, 1);
  sourceAllowed = true;
  stale = true;
  assert.equal((await route.GET(request)).status, 409);
  assert.equal(renderCount, 1);
});


test("invoice preparation removes invented email sends before SMTP checks and execution", async () => {
  const f = executionFixture();
  const [proposal] = await f.prepareAgentActions([{ type: "create_invoice", companyId, items: [{ productSku: "PLA", quantity: 100 }], email: { ...email, delivery: "send" } }], viewer, "ask", { messages: [{ role: "user", content: "Prepare a draft invoice for review only" }] });
  assert.equal("email" in proposal.action, false);
  await f.executeAgentAction(actionId, proposal.action, viewer, request);
  assert.equal(f.savedInvoices.length, 1);
  assert.equal(f.sent.length, 0);
});
