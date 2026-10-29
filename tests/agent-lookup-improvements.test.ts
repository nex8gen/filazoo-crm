import * as replyTools from "../lib/ai/crm-reply-tools.ts";
import * as readiness from "../lib/ai/invoice-readiness.ts";
import test from "node:test";
import { personalProductService } from "./helpers/personal-products.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as tools from "../lib/ai/crm-tools.ts";
import * as products from "../lib/product-utils.ts";
import * as emailAccess from "../lib/email-access.ts";

const require = createRequire(import.meta.url);
const actorId = "a1111111-1111-4111-8111-111111111111";
const companyId = "b2222222-2222-4222-8222-222222222222";
const otherId = "c3333333-3333-4333-8333-333333333333";
const viewer = { id: actorId, role: "admin" as const, displayName: "Audit", email: "audit@example.com" };
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? (name === "./crm-reply-tools" ? replyTools : name === "./crm-reply-execution" ? { replyOperationTarget: () => { throw new Error("Reply workflows use their dedicated fixtures"); } } : name === "../data/customer-reply-requests" ? { listReplyRequests: async () => [] } : name === "@/lib/ai/invoice-readiness" ? readiness : undefined) ?? require(name), Error, console });
  return exports as T;
}
type Row = Record<string, unknown>;
function fixture() {
  const rows: Record<string, Row[]> = {
    companies: [{ id: companyId, name: "Different company name" }, { id: otherId, name: "Another company" }],
    contacts: [{ company_id: companyId, email: "SECONDARY@example.com" }],
    products: [{ sku: "PLA", name: "PLA filament", active: false, price: 2.5, stock_status: "Audit", tags: [products.variantTag([{ id: "white", name: "White", sku: "PLA-WHITE", price: "2.50", stockStatus: "Audit", imageUrl: null }])] }],
  };
  const calls: Array<{ table: string; method: string; key?: string; value?: unknown }> = [];
  const db = { from(table: string) {
    let start = 0, end = 9;
    const filters: Array<(row: Row) => boolean> = [];
    const q = { select(value: string) { calls.push({ table, method: "select", value }); return q; }, eq(key: string, value: unknown) { filters.push((row) => row[key] === value); calls.push({ table, method: "eq", key, value }); return q; },
      in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return q; }, order() { return q; },
      ilike(key: string, pattern: string) { calls.push({ table, method: "ilike", key, value: pattern }); const wanted = pattern.replace(/\\([\\%_])/g, "$1").toLowerCase(); filters.push((row) => String(row[key]).toLowerCase() === wanted); return q; },
      range(from: number, to: number) { start = from; end = to; calls.push({ table, method: "range", value: [from, to] }); return q; },
      then(resolve: (value: unknown) => unknown) { const matching = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))); return Promise.resolve({ data: matching.slice(start, end + 1), count: matching.length, error: null }).then(resolve); } };
    return q;
  } };
  const dependencies = { "../data/product-personalization": personalProductService(rows), "../supabase/admin": { createSupabaseAdmin: () => db }, "../data/flows": {}, "../data/members": {}, "./agent-records": {}, "./crm-tools": tools, "../data/inventory": {}, "./crm-productivity-records": {}, "../product-utils": products };
  return { ...load<typeof import("../lib/ai/crm-records.ts")>("../lib/ai/crm-records.ts", dependencies), rows, calls };
}

test("customer lookups resolve exact secondary contact addresses and preserve ambiguous matches", async () => {
  const f = fixture();
  const lookup = tools.crmReadSchema.parse({ resource: "companies", query: "secondary@example.com" });
  const result = await f.readCrmRecords(viewer, lookup);
  assert.equal(result.records.length, 1); assert.equal((result.records[0] as { id: string }).id, companyId);
  assert.ok(f.calls.some((call) => call.table === "contacts" && call.method === "ilike" && call.key === "email"));
  f.rows.contacts.push({ company_id: otherId, email: "secondary@example.com" });
  assert.equal((await f.readCrmRecords(viewer, lookup)).records.length, 2, "Do not silently choose one company for a duplicate email");
  const missing = await f.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "companies", query: "missing@example.com" }));
  assert.equal(missing.records.length, 0);
});

test("email filter wildcard characters stay literal", async () => {
  const f = fixture(); f.rows.contacts = [{ company_id: companyId, email: "buyer%_@example.com" }];
  const result = await f.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "companies", query: "buyer%_@example.com" }));
  assert.equal(result.records.length, 1);
  assert.equal(f.calls.find((call) => call.table === "contacts" && call.method === "ilike")?.value, "buyer\\%\\_@example.com");
});

test("exact inactive variant SKUs resolve to their real parent and variant ID", async () => {
  const f = fixture();
  const result = await f.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "products", id: "PLA-WHITE" }));
  assert.equal(result.records.length, 1);
  const product = result.records[0] as { sku: string; active: boolean; matchedVariants: { id: string; sku: string }[] };
  assert.equal(product.sku, "PLA"); assert.equal(product.active, false); assert.equal(product.matchedVariants[0].id, "white");
  assert.equal(product.matchedVariants[0].sku, "PLA-WHITE");
  const lowerCase = await f.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "products", id: "pla" }));
  assert.equal((lowerCase.records[0] as { sku: string }).sku, "PLA");
});

test("variant scan cannot silently claim completeness past its bound", async () => {
  const f = fixture(); f.rows.products = Array.from({ length: 5001 }, (_, index) => ({ sku: `P-${index}`, tags: [], price: 1 }));
  await assert.rejects(() => f.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "products", id: "NOT-FOUND" })), /scan limit/);
});

test("conversation AI inventory excludes credentials/history and enforces current mailbox and assignment access", async () => {
  const mailbox = { id: companyId, type: "workspace", userId: actorId, smtpPassword: "NEVER-RETURN" };
  const data = [
    { id: companyId, mailbox_id: companyId, user_id: actorId, assigned_to: actorId, recipient: "allowed@example.com", status: "waiting_shipping", enabled: true, revision: 3, history: "PRIVATE BODY", anchors: ["private"], pending_document: { bank: "private" } },
    { id: otherId, mailbox_id: companyId, user_id: otherId, assigned_to: otherId, recipient: "allowed@example.com", history: "OTHER BODY" },
  ];
  const q = { select() { return q; }, in() { return q; }, or() { return q; }, order() { return q; }, range() { return q; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data, count: 2, error: null }).then(resolve); } };
  const records = load<typeof import("../lib/ai/crm-productivity-records.ts")>("../lib/ai/crm-productivity-records.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => ({ from: () => q }) }, "../data/mailboxes": { getViewerMailboxes: async () => [mailbox] },
    "../data/email-access": { getAssignedEmailContacts: async () => new Map([["allowed@example.com", companyId]]) }, "../email-access": emailAccess, "../data/email-auto-reply": {},
  });
  const result = await records.readAgentAutoReplies({ ...viewer, role: "bd_manager" }, tools.crmReadSchema.parse({ resource: "auto_replies" }));
  assert.equal(result.records.length, 1);
  assert.equal(result.coverage.matching, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE BODY|OTHER BODY|NEVER-RETURN|pending_document|anchors/);
  await assert.rejects(() => records.readAgentAutoReplies({ ...viewer, role: "viewer" }, tools.crmReadSchema.parse({ resource: "auto_replies" })), /sales workspace role/);
});
