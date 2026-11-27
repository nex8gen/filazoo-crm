import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as access from "../lib/ai/customer-access.ts";
import { defaultAiPolicy, aiReadResources } from "../lib/ai-policy.ts";
import { crmReadSchema } from "../lib/ai/crm-tools.ts";
import * as chatHistory from "../lib/ai/chat-history.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";

const require = createRequire(import.meta.url);
const own = "15693adc-0bdf-4617-b214-000000000001", other = "15693adc-0bdf-4617-b214-000000000002", unassigned = "15693adc-0bdf-4617-b214-000000000003";
const viewer = (role: WorkspaceViewer["role"], id = "member-one") => ({ id, role, workspaceId: "workspace-one", displayName: "Test" }) as WorkspaceViewer;
type Row = Record<string, unknown>;

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? (name === "server-only" ? {} : require(name)), Error, Date, URL, console });
  return exports as T;
}

function fixture() {
  const assignments: Row[] = [{ company_id: own, owner_id: "member-one" }, { company_id: other, owner_id: "member-two" }];
  const companies = [own, other, unassigned].map((id, index) => ({ id, name: ["Assigned Buyer", "PRIVATE OTHER BUYER", "PRIVATE UNASSIGNED BUYER"][index], country: "US", contacts: [{ email: `buyer${index}@example.test`, name: "Buyer" }], account: assignments.filter(row => row.company_id === id), pipeline: assignments.filter(row => row.company_id === id) }));
  const tables: Record<string, Row[]> = {
    pipeline: assignments, companies,
    contacts: companies.map((row, index) => ({ id: `contact-${index}`, company_id: row.id, email: `buyer${index}@example.test` })),
    invoices: companies.map(row => ({ id: row.id, company_id: row.id, number: 1, document: { companyId: row.id, customerName: row.name } })),
    purchase_orders: companies.map(row => ({ id: row.id, company_id: row.id, reference: row.name })),
    crm_tasks: companies.map(row => ({ id: row.id, company_id: row.id, assigned_to: "member-one", title: row.name })),
    company_profiles: [], customer_billing_profiles: [],
  };
  const calls: string[] = [];
  function values(row: Row, path: string[]): unknown[] {
    if (!path.length) return [row];
    const [head, ...tail] = path;
    const next = head === "ai_company" ? companies.find(company => company.id === row.company_id) : row[head];
    return (Array.isArray(next) ? next : [next]).flatMap(value => tail.length && value && typeof value === "object" ? values(value as Row, tail) : tail.length ? [] : [value]);
  }
  const db = { from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let start = 0, end = 999;
    const execute = () => {
      calls.push(table);
      const matching = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
      return { data: matching.slice(start, end + 1), error: null, count: matching.length };
    };
    const query = {
      select() { return query; }, order() { return query; },
      eq(key: string, value: unknown) { filters.push(row => values(row, key.split(".")).includes(value)); return query; },
      in(key: string, ids: unknown[]) { filters.push(row => ids.includes(row[key])); return query; },
      or(expression: string) {
        if (table === "contacts") {
          const addresses = [...expression.matchAll(/email\.ilike\.("(?:\\.|[^"\\])*")/g)].map(match => String(JSON.parse(match[1])).toLowerCase());
          filters.push(row => addresses.includes(String(row.email).toLowerCase()));
        }
        return query;
      },
      ilike(key: string, pattern: string) { filters.push(row => String(row[key]).toLowerCase().includes(pattern.replaceAll("%", "").toLowerCase())); return query; },
      range(from: number, to: number) { start = from; end = to; return query; },
      limit(count: number) { end = count - 1; return query; },
      async maybeSingle() { const result = execute(); return { ...result, data: result.data[0] ?? null }; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(execute()).then(resolve); },
    };
    return query;
  } };
  const database = db as unknown as Parameters<typeof access.assertAiCustomerAccess>[2];
  const histories = new Map(companies.map((row, index) => [row.id as string, { emails: [{ id: `message-${row.id}`, companyId: row.id, company: row.name, mailboxId: "another-staff-mailbox", direction: "inbound", status: "Received", contact: `buyer${index}@example.test`, body: `Conversation for ${row.name}`, bodyLoaded: true, subject: "Buying request", timestamp: "2026-11-27T01:00:00Z" }], inboxError: null }]));
  let historyReads = 0, bodyReads = 0;
  const history = load<typeof import("../lib/ai/customer-email-history.ts")>("../lib/ai/customer-email-history.ts", {
    "../data/ai-settings": { requireAiData: async () => defaultAiPolicy() }, "../supabase/admin.ts": { createSupabaseAdmin: () => db }, "./customer-access.ts": access,
    "../data/mailboxes": { getViewerMailboxes: async () => [] },
    "../data/company-emails": { getCompaniesEmailBackendData: async (ids: string[]) => { historyReads++; return new Map(ids.map(id => [id, histories.get(id)!])); } },
    "../data/company-email-access": { readCompanyMailboxEmail: async () => { bodyReads++; return null; } },
    "./customer-conversations.ts": {},
  });
  const profiles = load<typeof import("../lib/ai/agent-records.ts")>("../lib/ai/agent-records.ts", {
    "../data/ai-settings": { requireAiData: async () => defaultAiPolicy() }, "../supabase/admin": { createSupabaseAdmin: () => db }, "./customer-access.ts": access,
    "../company-commerce": { commerceDefaults: () => ({}) }, "../email-inbox": {}, "../data/mailboxes": { getViewerMailboxes: async () => [] },
    "../data/mailbox-sync": {}, "../email-threading": { threadKeyForEmail: (email: { id: string }) => email.id }, "./customer-email-history": history,
  });
  const records = load<typeof import("../lib/ai/crm-records.ts")>("../lib/ai/crm-records.ts", {
    "../data/ai-settings": { requireAiData: async () => defaultAiPolicy() }, "../ai-policy": { aiReadResources }, "../supabase/admin": { createSupabaseAdmin: () => db },
    "./customer-access.ts": access, "./agent-records": profiles, "./crm-tools": { crmReadSchema },
    "../data/customer-reply-requests": {}, "../data/flows": {}, "../data/members": {}, "../data/inventory": {}, "./crm-productivity-records": {}, "../product-utils": {}, "../data/product-personalization": {},
  });
  return { assignments, tables, calls, database, db, histories, history, profiles, records, historyReads: () => historyReads, bodyReads: () => bodyReads };
}

for (const role of ["operator", "bd_manager", "viewer"] as const) test(`${role} AI can read only assigned profiles, records and staff conversations`, async () => {
  const f = fixture(), actor = viewer(role);
  assert.deepEqual(await access.assignedAiCustomerIds(actor, f.database), [own]);
  await access.assertAiCustomerAccess(actor, own, f.database);
  await assert.rejects(() => access.assertAiCustomerAccess(actor, other, f.database), /not assigned/);
  await assert.rejects(() => f.profiles.loadAgentCompany(other, false, actor), /not assigned/);
  for (const resource of ["companies", "orders", "invoices", "tasks"] as const) {
    const result = await f.records.readCrmRecords(actor, { resource, query: "", offset: 0 });
    assert.equal(result.records.length, 1, resource);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE OTHER|PRIVATE UNASSIGNED/);
  }
  const email = await f.history.loadCustomerEmailHistories(actor, [own]);
  assert.equal(email.get(own)?.emails[0].mailboxId, "another-staff-mailbox", "Assignment authorizes customer correspondence across staff mailboxes");
  await assert.rejects(() => f.history.loadCustomerEmailHistories(actor, [other]), /not assigned/);
  const search = await f.profiles.searchAgentEmails(actor, { query: "", direction: "all", offset: 0 });
  assert.equal(search.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(search), /PRIVATE OTHER|PRIVATE UNASSIGNED/);
});

test("administrator AI sees all workspace customers and conversations across staff mailboxes", async () => {
  const f = fixture(), actor = viewer("admin");
  assert.equal(await access.assignedAiCustomerIds(actor, f.database), null);
  const result = await f.records.readCrmRecords(actor, { resource: "companies", query: "", offset: 0 });
  assert.equal(result.records.length, 3);
  const search = await f.profiles.searchAgentEmails(actor, { query: "", direction: "all", offset: 0 });
  assert.equal(search.messages.length, 3);
  assert.match(JSON.stringify(search), /PRIVATE OTHER BUYER/);
  assert.match(JSON.stringify(search), /PRIVATE UNASSIGNED BUYER/);
});

test("reassignment and switching users cannot reuse a previously authorized conversation cache", async () => {
  const f = fixture(), context = {};
  await f.history.loadCustomerEmailHistories(viewer("operator"), [own], context);
  f.assignments[0].owner_id = "member-two";
  await assert.rejects(() => f.history.loadCustomerEmailHistories(viewer("operator"), [own], context), /not assigned/);
  const next = await f.history.loadCustomerEmailHistories(viewer("operator", "member-two"), [other], context);
  assert.equal(next.has(own), false);
  assert.equal(next.get(other)?.emails[0].companyId, other);
});

test("a broad administrator email index cannot widen a regular user's later search", async () => {
  const f = fixture();
  const index = f.profiles.loadAgentEmailIndex(viewer("admin"));
  const result = await f.profiles.searchAgentEmails(viewer("operator"), { query: "", direction: "all", offset: 0 }, index);
  assert.equal(result.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE OTHER|PRIVATE UNASSIGNED/);
});

test("shared contact addresses cannot expose an unassigned customer's conversation", async () => {
  const f = fixture();
  f.tables.contacts.push({ id: "shared", company_id: other, email: "buyer0@example.test" });
  const result = await f.history.loadCustomerEmailHistories(viewer("operator"), [own]);
  assert.equal(result.get(own)?.emails.length, 0);
  assert.match(result.get(own)?.inboxError ?? "", /ambiguous/);
  assert.equal(f.bodyReads(), 0);
});

test("draft and scheduled-email metadata is limited to uniquely assigned recipients", async () => {
  const f = fixture();
  const rows = [{ id: "own", to: "buyer0@example.test", subject: "Assigned buyer" }, { id: "other", to: "buyer1@example.test", subject: "PRIVATE OTHER BUYER" }, { id: "mixed", to: "buyer0@example.test, buyer1@example.test" }];
  const permitted = await access.assignedRecipientRecords(viewer("operator"), rows, f.database);
  assert.deepEqual(permitted.map(row => row.id), ["own"]);
  f.tables.contacts.push({ id: "shared", company_id: other, email: "buyer0@example.test" });
  assert.equal((await access.assignedRecipientRecords(viewer("operator"), rows, f.database)).length, 0);
  assert.equal((await access.assignedRecipientRecords(viewer("admin"), rows, f.database)).length, 3);
});

for (const role of ["operator", "bd_manager", "viewer"] as const) test(`${role} saved-chat access changes when customer assignment changes, even without contacts`, async () => {
  const f = fixture(), actor = viewer(role);
  const server = load<typeof import("../lib/ai/chat-history-server.ts")>("../lib/ai/chat-history-server.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => f.db }, "./customer-access.ts": access, "./chat-history": chatHistory,
    "../data/mailboxes": { getViewerMailboxes: async () => [] }, "../data/email-access": { getAssignedEmailContacts: async () => new Map() },
  });
  const original = await server.conversationAccessKey(actor);
  await assert.rejects(() => server.assertConversationAccess({ mode: "customer", pathname: `/companies/${other}`, pageContext: { companyId: other } }, actor), /no longer available/);
  f.assignments[0].owner_id = "member-two";
  assert.notEqual(await server.conversationAccessKey(actor), original);
  await assert.rejects(() => server.assertConversationAccess({ mode: "customer", pathname: `/companies/${own}`, pageContext: { companyId: own } }, actor), /no longer available/);
});
