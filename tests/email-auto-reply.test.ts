import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as autoReply from "../lib/email-auto-reply.ts";
import * as threading from "../lib/email-threading.ts";
import * as invoiceLinks from "../lib/invoice-links.ts";
import * as invoices from "../lib/invoices.ts";
import * as defaults from "../lib/invoice-defaults.ts";
import * as permissions from "../lib/invoice-permissions.ts";
import * as commerce from "../lib/company-commerce.ts";
import * as reply from "../lib/ai/email-reply.ts";
import * as policy from "../lib/outreach-policy.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

const message = (id: string, extra: Partial<InboxEmailItem> = {}): InboxEmailItem => ({
  id, messageId: `<${id}@test.example>`, direction: "inbound", contact: "buyer@example.com", status: "Received",
  subject: "Products", body: "What is your MOQ?", bodyLoaded: true, company: "Buyer", preview: "",
  timestamp: "2026-10-28T01:00:00Z", ...extra,
});

test("only linked messages join a conversation; identical subjects and senders remain separate", () => {
  const root = message("root"), response = message("child", { inReplyTo: root.messageId }), unrelated = message("unrelated");
  assert.deepEqual(autoReply.autoReplyConversation([unrelated, response, root], [root.messageId!]).map((item) => item.id).sort(), ["child", "root"]);
});

test("saved original history survives header refreshes and deduplicates Message-ID casing", () => {
  const old = message("old", { body: "Confirmed earlier commitment" });
  const header = message("new-provider-id", { messageId: old.messageId!.toUpperCase(), bodyLoaded: false, body: "" });
  const merged = autoReply.mergeAutoReplyHistory([old], [header, message("reply", { timestamp: "2026-10-28T02:00:00Z" })]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].body, old.body);
});

test("shipping supports explicit free shipping and rejects negative, fractional-cent and exponent inputs", () => {
  assert.equal(autoReply.shippingMinorFromInput("0"), 0);
  assert.equal(autoReply.shippingMinorFromInput("120.35"), 12035);
  for (const invalid of ["", "-1", "1.001", "1e2", "Infinity", "1,200", "1000000.01"]) assert.throws(() => autoReply.shippingMinorFromInput(invalid));
});

type Row = Record<string, unknown>;
function workerFixture() {
  const first = message("root", { timestamp: "2026-10-27T01:00:00Z" });
  const next = message("next", { references: [first.messageId!], timestamp: "2026-10-28T01:00:00Z" });
  const row: Row = {
    id: "automation", mailbox_id: "mailbox", sender_id: "mailbox", user_id: "owner", assigned_to: "owner", recipient: next.contact,
    enabled: true, status: "active", revision: 1, anchors: [first.messageId!], history: [first], enabled_at: "2026-10-27T02:00:00Z",
    thread_key: `message:${first.messageId}`, last_message_key: first.messageId, pending_message_key: null,
  };
  const document = { ...invoices.blankInvoiceDocument("2026-10-28"), customerName: "Buyer", customerEmail: next.contact,
    customerAddress: "Billing office, Test city", shippingAddress: "Warehouse, Test city", shippingRecipient: "Buyer",
    items: [{ description: "PLA", quantity: 10, unitPriceMinor: 1000, taxBps: 0, productSku: "PLA", pricingMode: "catalog" as const }], shippingMinor: 12345 };
  const tables: Record<string, Row[]> = {
    email_auto_replies: [row], email_auto_reply_deliveries: [], mailbox_sent_messages: [], email_reply_knowledge: [{ title: "MOQ", content: "Minimum 10 units" }],
    workspace_members: [{ user_id: "owner", role: "admin", activated_at: "2026-01-01", display_name: "Manager" }],
    contacts: [], companies: [], suppression: [], crm_tasks: [],
  };
  const calls = { provider: 0, smtp: 0, invoice: 0, issue: 0, handoff: 0, uploads: 0 };
  let plan: autoReply.AutoReplyPlan = { action: "reply", reason: "", body: "Hello, our minimum is 10 units.", attachCatalog: false,
    catalogSkus: [], invoiceItems: [], billingName: "", billingAddress: "", shippingAddress: "", shippingRecipient: "", shippingPhone: "" };
  let fresh = [first, next];
  let failSmtp = false;
  let onProvider: (() => void) | undefined;
  const savedInvoices: invoices.Invoice[] = [];
  function from(table: string) {
    const filters: Array<(entry: Row) => boolean> = [];
    let patch: Row | undefined, insertion: Row | undefined, single = false;
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push((entry) => entry[key] === value); return query; },
      neq: (key: string, value: unknown) => { filters.push((entry) => entry[key] !== value); return query; },
      not: (key: string, _operator: string, value: unknown) => { filters.push((entry) => entry[key] !== value); return query; },
      in: (key: string, values: unknown[]) => { filters.push((entry) => values.includes(entry[key])); return query; },
      gte: () => query, lt: () => query, order: () => query, limit: () => query,
      update: (value: Row) => { patch = value; return query; }, insert: (value: Row) => { insertion = value; return query; },
      maybeSingle: () => { single = true; return query; }, single: () => { single = true; return query; },
      throwOnError: () => query,
      then: (resolve: (value: unknown) => unknown, reject?: (cause: unknown) => unknown) => {
        try {
          const rows = tables[table] ?? [];
          if (insertion) {
            if (table === "email_auto_reply_deliveries" && rows.some((value) => value.automation_id === insertion!.automation_id && value.message_key === insertion!.message_key))
              return Promise.resolve({ data: null, error: { code: "23505" } }).then(resolve, reject);
            rows.push({ id: `created-${rows.length}`, ...insertion });
            tables[table] = rows;
          }
          const matches = insertion ? [rows.at(-1)!] : rows.filter((entry) => filters.every((filter) => filter(entry)));
          if (patch) for (const entry of matches) Object.assign(entry, patch);
          const data = JSON.parse(JSON.stringify(single ? matches[0] ?? null : matches));
          return Promise.resolve({ data, error: null, count: matches.length }).then(resolve, reject);
        } catch (cause) { return Promise.reject(cause).then(resolve, reject); }
      },
    };
    return query;
  }
  const db = { from, storage: { from: () => ({ upload: async () => { calls.uploads++; return { error: null }; } }) }, rpc: async (_name: string, input: Row) => {
    assert.equal(row.enabled, true);
    assert.equal(row.revision, input.p_revision);
    calls.handoff++;
    Object.assign(row, { status: input.p_status, pending_document: input.p_document, pending_message_key: input.p_message_key, history: input.p_history, last_error: input.p_reason, processing_at: null });
    return { data: null, error: null };
  } };
  // Match Supabase's thenable RPC interface.
  const rpc = db.rpc;
  Object.assign(db, { rpc: (...args: Parameters<typeof rpc>) => ({ throwOnError: () => rpc(...args) }) });
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { randomUUID: () => "sent-record" },
    "../supabase/admin": { createSupabaseAdmin: () => db }, "../email-auto-reply": autoReply,
    "./email-auto-reply": { authorizeAutoReply: async () => undefined,
      mailboxHistory: async () => ({ mailbox: { id: "mailbox" }, messages: fresh }), hydrateAutoReplyHistory: async (_box: unknown, history: unknown) => history },
    "./flow-ai-reply": { loadFlowReplyProducts: async () => [{ sku: "PLA", name: "PLA", currency: "USD", price: 10, moq: 10, tags: [], color: null, active: true }] },
    "../invoice-links": invoiceLinks, "../ai/email-reply": reply,
    "../ai/gemini": { generateGeminiText: async () => { calls.provider++; onProvider?.(); return JSON.stringify(plan); } },
    "../ai/gateway": {}, "../ai/email-rewrite": { applyEmailSignature: (body: string) => body, DEFAULT_EMAIL_COMPANY: "Filazoo", DEFAULT_EMAIL_TITLE: "Manager" },
    "../product-utils": { crmProduct: (product: unknown) => product }, "../catalog-pdf": { buildCatalogPdf: () => Buffer.from("%PDF-synthetic-catalog") }, "./catalog-pdfs": {},
    "./invoice-connections": { invoiceBootstrap: async () => ({ document, billing: null }) },
    "../invoices": invoices, "../invoice-permissions": permissions, "../company-commerce": commerce,
    "./invoices": { getInvoice: async () => null,
      createInvoice: async (doc: invoices.InvoiceDocument, _user: string, id: string) => { calls.invoice++; const invoice = { id, document: doc, status: "draft", number: 1, revision: 1, total_minor: 20000, paid_minor: 0 } as invoices.Invoice; savedInvoices.push(invoice); return invoice; },
      mutateInvoice: async (id: string) => { calls.issue++; return { ...savedInvoices.find((invoice) => invoice.id === id), status: "issued" }; } },
    "./invoice-payment-methods": { invoicePaymentMethods: async () => [] },
    "./invoice-defaults": { getInvoiceDefaults: async () => defaults.readInvoiceDefaults({}) },
    "../invoice-pdf": { renderInvoicePdf: async () => Buffer.from("%PDF-synthetic") },
    "./mailboxes": { getViewerMailbox: async () => ({ id: "mailbox", email: "sales@example.com" }), mailboxHasSmtp: () => true },
    "../email-threading": threading, "../mailer": { sendMailboxEmail: async () => { calls.smtp++; if (failSmtp) throw new Error("Connection lost after DATA"); return { messageId: "<sent@example.com>" }; } },
    "../outreach-policy": policy, "../env": { env: { DAILY_SEND_LIMIT: 200, BOUNCE_PAUSE_PERCENT: 3, dryRun: false } },
  };
  const exports: { processEmailAutoReply?: (id: string) => Promise<void> } = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-auto-reply-worker.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    Buffer, process: { env: { GEMINI_API_KEY: "synthetic" } }, console });
  return { row, calls, tables, document, savedInvoices, first, next, run: () => exports.processEmailAutoReply!("automation"),
    setPlan: (value: Partial<autoReply.AutoReplyPlan>) => { plan = { ...plan, ...value }; },
    setFresh: (messages: InboxEmailItem[]) => { fresh = messages; }, setFailSmtp: () => { failSmtp = true; },
    onProvider: (fn: () => void) => { onProvider = fn; } };
}

test("automation is off by default and enabling never answers old mail", async () => {
  const fixture = workerFixture();
  fixture.row.enabled = false;
  await fixture.run();
  assert.equal(fixture.calls.provider, 0);
  fixture.row.enabled = true;
  fixture.setFresh([fixture.first]);
  await fixture.run();
  assert.equal(fixture.calls.provider, 0);
  assert.equal(fixture.calls.smtp, 0);
});

test("new customer replies are sent once across repeated background runs", async () => {
  const fixture = workerFixture();
  await fixture.run(); await fixture.run();
  assert.equal(fixture.calls.provider, 1);
  assert.equal(fixture.calls.smtp, 1);
  assert.equal(fixture.tables.email_auto_reply_deliveries.length, 1);
  assert.equal(fixture.row.status, "active");
});

test("invoice request pauses for shipping without replying or creating an invoice", async () => {
  const fixture = workerFixture();
  fixture.setPlan({ action: "invoice", invoiceItems: [{ productSku: "PLA", variantId: null, quantity: 10 }] });
  await fixture.run();
  assert.equal(fixture.row.status, "waiting_shipping", String(fixture.row.last_error));
  assert.equal(fixture.calls.handoff, 1);
  assert.equal(fixture.calls.smtp, 0);
  assert.equal(fixture.calls.invoice, 0);
  const revision = fixture.row.revision;
  await fixture.run();
  assert.equal(fixture.row.revision, revision, "Idle polling must not invalidate a shipping form");
});

test("catalog requests generate a PDF attachment before delivery", async () => {
  const fixture = workerFixture();
  fixture.setPlan({ attachCatalog: true, catalogSkus: ["PLA"], body: "Your catalog is attached." });
  await fixture.run();
  assert.equal(fixture.calls.smtp, 1);
  assert.equal(fixture.calls.uploads, 1);
  const attachments = fixture.tables.mailbox_sent_messages[0].attachments as Row[];
  assert.equal(attachments[0].contentType, "application/pdf");
  assert.match(String(attachments[0].filename), /catalog.*\.pdf/);
});

test("unknown catalog selections stop delivery instead of attaching another product", async () => {
  const fixture = workerFixture();
  fixture.setPlan({ attachCatalog: true, catalogSkus: ["UNKNOWN"] });
  await fixture.run();
  assert.equal(fixture.calls.smtp, 0);
  assert.equal(fixture.row.status, "needs_review");
});

test("approved shipping creates and sends an invoice containing the exact approved cost", async () => {
  const fixture = workerFixture();
  Object.assign(fixture.row, { status: "ready", pending_document: fixture.document, pending_message_key: fixture.next.messageId });
  await fixture.run();
  assert.equal(fixture.calls.invoice, 1, String(fixture.row.last_error));
  assert.equal(fixture.savedInvoices[0].document.shippingMinor, 12345);
  assert.equal(fixture.calls.issue, 1);
  assert.equal(fixture.calls.smtp, 1);
  assert.equal(fixture.calls.uploads, 1);
});

test("BD shipping handoff sends a draft and preserves billing issue permissions", async () => {
  const fixture = workerFixture();
  fixture.tables.workspace_members[0].role = "bd_manager";
  Object.assign(fixture.row, { status: "ready", pending_document: fixture.document, pending_message_key: fixture.next.messageId });
  await fixture.run();
  assert.equal(fixture.calls.invoice, 1, String(fixture.row.last_error));
  assert.equal(fixture.calls.issue, 0);
  assert.equal(fixture.calls.smtp, 1);
  assert.match(String(fixture.tables.mailbox_sent_messages[0].body), /draft invoice/);
});

test("a new customer correction invalidates approved shipping and sends nothing", async () => {
  const fixture = workerFixture();
  Object.assign(fixture.row, { status: "ready", pending_document: fixture.document, pending_message_key: fixture.first.messageId });
  await fixture.run();
  assert.equal(fixture.row.status, "needs_review");
  assert.equal(fixture.calls.invoice, 0);
  assert.equal(fixture.calls.smtp, 0);
});

test("a manual stop during generation wins over pending automatic send", async () => {
  const fixture = workerFixture();
  fixture.onProvider(() => Object.assign(fixture.row, { enabled: false, status: "paused", revision: Number(fixture.row.revision) + 1 }));
  await fixture.run();
  assert.equal(fixture.calls.smtp, 0);
  assert.equal(fixture.row.enabled, false);
  assert.equal(fixture.row.status, "paused");
});

test("uncertain SMTP delivery requires review and never retries automatically", async () => {
  const fixture = workerFixture();
  fixture.setFailSmtp();
  await fixture.run(); await fixture.run();
  assert.equal(fixture.calls.smtp, 1);
  assert.equal(fixture.row.status, "needs_review");
  assert.equal(fixture.tables.email_auto_reply_deliveries[0].status, "failed");
});

test("automatic replies and unavailable policies are handed to a person without sending", async () => {
  const fixture = workerFixture();
  fixture.setFresh([fixture.first, { ...fixture.next, automaticResponse: true }]);
  await fixture.run();
  assert.equal(fixture.calls.provider, 0);
  assert.equal(fixture.calls.smtp, 0);
  assert.equal(fixture.row.status, "needs_review");
  const missingPolicy = workerFixture();
  missingPolicy.setPlan({ action: "review", reason: "Warranty policy is not in approved business facts." });
  await missingPolicy.run();
  assert.equal(missingPolicy.calls.smtp, 0);
  assert.equal(missingPolicy.row.status, "needs_review");
});
