import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { defaultAiPolicy } from "../lib/ai-policy.ts";
import { crmReadSchema } from "../lib/ai/crm-tools.ts";
import { customerIntelligenceInstruction, customerSalesTotals, isCustomerIntelligenceRequest } from "../lib/ai/customer-intelligence.ts";
import * as intelligence from "../lib/ai/customer-intelligence.ts";
import { threadKeyForEmail } from "../lib/email-threading.ts";

const require = createRequire(import.meta.url);
const id = "15693adc-0bdf-4617-b214-71b1861764a9";
const otherId = "25693adc-0bdf-4617-b214-71b1861764a9";
const viewer = { id: "35693adc-0bdf-4617-b214-71b1861764a9", role: "admin" as const, displayName: "Test", email: "test@example.com" };
type Row = Record<string, unknown>;

function fixture() {
  const policy = defaultAiPolicy();
  const calls: Array<{ table: string; method: string; key?: string; value?: unknown }> = [];
  const rows: Record<string, Row[]> = {
    companies: [{ id, name: "Print Studio", contacts: [{ id: "contact", email: "BUYER@example.com", name: "Buyer" }], company_profiles: [{ summary: "Interested in filament", fit_score: 8 }], pipeline: [{ owner_id: viewer.id }] }],
    contacts: [{ id: "contact", company_id: id, email: "BUYER@example.com" }],
    events: [{ id: "note", company_id: id, type: "staff_comment", data: { summary: "Confirm sample color first." }, created_at: "2026-11-20T10:00:00Z" }],
    invoices: [{ id: "invoice", company_id: id, status: "issued", total_minor: 10000, paid_minor: 2500, document: { currency: "USD" } }],
    purchase_orders: [{ id: "order", company_id: id, document: { currency: "USD", status: "confirmed", items: [{ description: "Black PLA", quantity: 500 }] } }],
    catalogs: [], crm_tasks: [],
  };
  const emails = [
    { id: "mail-1", direction: "inbound", status: "Received", body: "We want 500 rolls of black PLA.", subject: "Black PLA", timestamp: "2026-11-20T10:00:00Z", threadId: "thread-1" },
    { id: "mail-2", direction: "outbound", status: "Sent", body: "Please confirm the sample color.", subject: "Re: Black PLA", timestamp: "2026-11-21T10:00:00Z", threadId: "thread-1" },
    { id: "draft-1", direction: "outbound", status: "Draft", body: "Unsent sales pitch", subject: "New pitch", timestamp: "2026-11-25T10:00:00Z" },
    { id: "failed-1", direction: "outbound", status: "Failed", body: "Failed sales pitch", subject: "New pitch", timestamp: "2026-11-25T10:00:00Z" },
  ].map(email => ({ ...email, contact: "buyer@example.com", company: "Print Studio", companyId: id, mailboxId: "mailbox", bodyLoaded: true }));
  const coverage = { mailboxesSearched: 1, mailboxesOmitted: 0, mailboxError: null as string | null };
  const errors = new Set<string>();
  let indexReads = 0;
  const db = { from(table: string) {
    calls.push({ table, method: "from" });
    let from = 0, to = 999;
    const filters: Array<(row: Row) => boolean> = [];
    const query = {
      select(value: string) { calls.push({ table, method: "select", value }); return query; },
      eq(key: string, value: unknown) { calls.push({ table, method: "eq", key, value }); filters.push(row => key === "pipeline.owner_id" ? (row.pipeline as Row[])?.some(account => account.owner_id === value) : row[key] === value); return query; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
      or(value: string) {
        if (table === "contacts") {
          const addresses = [...value.matchAll(/email\.ilike\.("(?:\\.|[^"\\])*")/g)].map(match => String(JSON.parse(match[1])).replace(/\\([\\%_])/g, "$1").toLowerCase());
          filters.push(row => addresses.includes(String(row.email).toLowerCase()));
        }
        return query;
      },
      ilike(key: string, pattern: string) { const needle = pattern.slice(1, -1).toLowerCase(); filters.push(row => String(row[key]).toLowerCase().includes(needle)); return query; },
      order() { return query; },
      range(start: number, end: number) { from = start; to = end; return query; },
      then(resolve: (result: unknown) => unknown) {
        const matching = (rows[table] ?? []).filter(row => filters.every(filter => filter(row)));
        return Promise.resolve({ data: errors.has(table) ? null : matching.slice(from, to + 1), error: errors.has(table) ? { message: "PRIVATE DB FAILURE" } : null, count: matching.length }).then(resolve);
      },
    };
    return query;
  } };
  const exports = {};
  const dependencies: Record<string, unknown> = {
    "server-only": {}, zod: { z }, "../data/ai-settings": { requireAiData: async () => { if (!policy.data.customers) throw new Error("Customer data denied"); return policy; } },
    "../supabase/admin": { createSupabaseAdmin: () => db }, "../email-threading": { threadKeyForEmail },
    "./customer-intelligence.ts": intelligence,
    "./agent-records": { loadAgentEmailIndex: async () => { indexReads++; return { inbox: { emails }, searched: [], coverage }; } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/ai/customer-intelligence-records.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Error, Date, console });
  return { ...(exports as typeof import("../lib/ai/customer-intelligence-records.ts")), policy, rows, calls, emails, coverage, errors, indexReads: () => indexReads };
}
const request = (companyId?: string, offset = 0) => crmReadSchema.parse({ resource: "customer_insights", companyId, offset });

test("customer briefs join both conversation directions, notes and sales with source links; unsent emails are excluded", async () => {
  const f = fixture();
  const result = await f.readCustomerInsights(viewer, request(id));
  const account = result.records[0];
  assert.equal(account.id, id); assert.equal(account.email.messages, 2); assert.equal(account.email.conversations, 1);
  assert.equal(account.email.inbound, 1); assert.equal(account.email.outbound, 1);
  assert.equal(account.email.records[1].body.text, "We want 500 rolls of black PLA.");
  assert.match(account.email.records[0].href, /^\/email\?mailbox=mailbox&thread=/);
  assert.equal(account.notes.records[0].summary.text, "Confirm sample color first.");
  assert.equal(account.orders.records[0].items[0].quantity, 500);
  assert.equal(account.sales.totals[0].outstandingMinor, 7500);
  assert.doesNotMatch(JSON.stringify(result), /Unsent sales pitch|Failed sales pitch/);
});

test("invoice aggregation separates currencies and drafts, excludes voids and never adds order values", () => {
  const row = { id, total_minor: 10000, paid_minor: 2500, document: { currency: "USD" } };
  const totals = customerSalesTotals([{ ...row, status: "issued" }, { ...row, status: "draft" }, { ...row, status: "void" }, { ...row, status: "issued", document: { currency: "EUR" } }]);
  assert.deepEqual(totals.map(value => value.currency), ["EUR", "USD"]);
  assert.deepEqual(totals[1], { currency: "USD", issuedMinor: 10000, paidMinor: 2500, outstandingMinor: 7500, draftMinor: 10000, invoiceCount: 2 });
});

test("customer pages expose coverage and later matching accounts rather than presenting a first-page ranking as exhaustive", async () => {
  const f = fixture();
  f.rows.companies = Array.from({ length: 23 }, (_, index) => ({ ...f.rows.companies[0], id: `${index}`, name: `Customer ${index}` }));
  const first = await f.readCustomerInsights(viewer, request());
  assert.equal(first.coverage.matching, 23); assert.equal(first.records.length, 20); assert.equal(first.coverage.nextOffset, 20);
  const last = await f.readCustomerInsights(viewer, request(undefined, 20));
  assert.equal(last.records.length, 3); assert.equal(last.coverage.nextOffset, null);
  assert.equal(last.records[2].name, "Customer 22");
});

test("restricted AI data and customer assignments are enforced before source reads", async () => {
  const f = fixture();
  f.policy.data.billing = false; f.policy.data.emails = false; f.policy.data.tasks = false;
  const result = await f.readCustomerInsights({ ...viewer, role: "bd_manager" }, request(id));
  assert.equal(result.records[0].email.available, false); assert.equal(result.records[0].sales.available, false);
  assert.equal(f.indexReads(), 0);
  assert.ok(f.calls.some(call => call.table === "companies" && call.key === "pipeline.owner_id" && call.value === viewer.id));
  assert.ok(!f.calls.some(call => ["invoices", "purchase_orders", "catalogs", "crm_tasks"].includes(call.table)));
  assert.equal(result.records[0].notes.records.length, 1);
  f.rows.companies[0].pipeline = [{ owner_id: "someone-else" }];
  assert.equal((await f.readCustomerInsights({ ...viewer, role: "bd_manager" }, request(id))).records.length, 0);
  f.policy.data.customers = false;
  const priorCalls = f.calls.length;
  await assert.rejects(() => f.readCustomerInsights(viewer, request(id)), /denied/);
  assert.equal(f.calls.length, priorCalls);
});

test("shared contact addresses cannot assign another company's conversations to a prospect", async () => {
  const f = fixture();
  f.rows.contacts.push({ id: "other-contact", company_id: otherId, email: "buyer@example.com" });
  const result = await f.readCustomerInsights(viewer, request(id));
  assert.equal(result.records[0].email.messages, 0);
  assert.equal(result.records[0].email.countsComplete, false);
  assert.equal(result.coverage.ambiguousContactAddresses, 1);
});

test("missing source data remains unknown and cached indexes are confined to the caller's request context", async () => {
  const f = fixture();
  f.errors.add("invoices"); f.coverage.mailboxError = "Partial mailbox history";
  const context = {};
  const first = await f.readCustomerInsights(viewer, request(id), context);
  await f.readCustomerInsights(viewer, request(id), context);
  assert.equal(f.indexReads(), 1);
  assert.equal(first.records[0].sales.available, false); assert.equal(first.records[0].sales.complete, false);
  assert.equal(first.records[0].email.countsComplete, false);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE DB FAILURE/);
  await f.readCustomerInsights(viewer, request(id), {});
  assert.equal(f.indexReads(), 2);
});

test("older records beyond the API's first 500 rows contribute to exact sales totals", async () => {
  const f = fixture();
  f.rows.invoices = Array.from({ length: 505 }, (_, index) => ({ ...f.rows.invoices[0], id: `invoice-${index}` }));
  const account = (await f.readCustomerInsights(viewer, request(id))).records[0];
  assert.equal(account.invoices.count, 505); assert.equal(account.invoices.complete, true);
  assert.equal(account.sales.totals[0].issuedMinor, 5050000);
  assert.equal(account.invoices.omittedEvidence, 485);
});

test("clipped bodies disclose missing evidence instead of implying every message was read", async () => {
  const f = fixture();
  f.emails[0].body = "x".repeat(5000);
  const email = (await f.readCustomerInsights(viewer, request(id))).records[0].email;
  assert.equal(email.countsComplete, true); assert.equal(email.complete, false);
  assert.equal(email.records[1].body.truncated, true);
  assert.equal(email.records[1].body.text.length, 3000);
});

test("analysis intent routing understands reported spelling errors while ordinary tasks keep normal routing", () => {
  for (const text of ["find this custon current stach", "find most possibal cusotmer willing to order", "anlyse customer sales", "analyze all customers", "客户当前状态分析"]) assert.ok(isCustomerIntelligenceRequest(text), text);
  assert.equal(isCustomerIntelligenceRequest("Draft a thank you email"), false);
  assert.match(customerIntelligenceInstruction, /rules.companyIds/);
  assert.match(customerIntelligenceInstruction, /outbound sales pitch/);
});
