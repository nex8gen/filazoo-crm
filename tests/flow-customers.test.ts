import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as customerTypes from "../lib/flow-customers.ts";

const companyId = "11111111-1111-4111-8111-111111111111";
const contactId = "22222222-2222-4222-8222-222222222222";
type Row = Record<string, unknown>;

function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? {}, Response, Request, URL, Error });
  return exports;
}

function service(authorized = true) {
  const calls: Array<{ table: string; operation: string; args: unknown[] }> = [];
  const rows: Record<string, Row[]> = {
    companies: Array.from({ length: 52 }, (_, i) => ({ id: i === 0 ? companyId : `company-${i}`, name: `Company ${String(i).padStart(2, "0")}` })),
    contacts: Array.from({ length: 52 }, (_, i) => ({ id: i === 0 ? contactId : `contact-${i}`, company_id: companyId, name: `Customer ${i}`, email: `customer${i}@example.com`, companies: { name: "Company 00" } })),
  };
  const exports = load("../lib/data/flow-customers.ts", {
    "../flow-customers.ts": customerTypes,
    "../auth.ts": { requireWorkspaceMember: async () => { if (!authorized) throw new Error("Authentication required"); } },
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from: (table: string) => {
      let selected = rows[table];
      const query = {
        select(...args: unknown[]) { calls.push({ table, operation: "select", args }); return query; },
        order() { return query; },
        eq(key: string, value: unknown) { selected = selected.filter((row) => row[key] === value); return query; },
        in(key: string, values: unknown[]) { selected = selected.filter((row) => values.includes(row[key])); return query; },
        ilike(...args: unknown[]) { calls.push({ table, operation: "ilike", args }); return query; },
        or(...args: unknown[]) { calls.push({ table, operation: "or", args }); return query; },
        range(start: number, end: number) { selected = selected.slice(start, end + 1); return query; },
        then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: selected, error: null }).then(resolve); },
      };
      return query;
    } }) },
  });
  return { run: exports.listFlowCustomers, calls, rows };
}

test("customer option queries require membership and valid bounded company/selection input", async () => {
  const app = service(false);
  await assert.rejects(app.run({ kind: "companies" }), /Authentication required/);
  assert.equal(app.calls.length, 0);
  for (const input of [{}, { companyId: "invalid" }, { ids: [] }, { ids: Array(201).fill(contactId) }, { kind: "companies", offset: -1 }, { kind: "companies", query: "x".repeat(121) }]) {
    assert.equal(customerTypes.flowCustomerQuerySchema.safeParse(input).success, false);
  }
});

test("companies and their customers are paginated without truncating selected customer lookups", async () => {
  const app = service();
  const first = await app.run({ kind: "companies" }) as { companies: Row[]; hasMore: boolean };
  assert.equal(first.companies.length, 50);
  assert.equal(first.hasMore, true);
  const next = await app.run({ kind: "companies", offset: 50 }) as typeof first;
  assert.equal(next.companies.length, 2);
  assert.equal(next.hasMore, false);
  const contacts = await app.run({ companyId }) as { customers: customerTypes.FlowCustomer[]; hasMore: boolean };
  assert.equal(contacts.customers.length, 50);
  assert.equal(contacts.customers[0].companyId, companyId);
  assert.equal(contacts.customers[0].companyName, "Company 00");
  assert.equal(contacts.hasMore, true);
  app.rows.contacts[1].company_id = "other-company";
  assert.equal((await app.run({ companyId }) as typeof contacts).customers.some((customer) => customer.id === "contact-1"), false);
  app.rows.contacts.push({ ...app.rows.contacts[0], id: companyId });
  const selected = await app.run({ ids: [contactId, companyId] }) as typeof contacts;
  assert.equal(selected.customers.length, 2);
  assert.equal(selected.hasMore, false);
});

test("customer search removes filter operators before building the PostgREST expression", async () => {
  const app = service();
  await app.run({ companyId, query: 'alex),email.eq.%_"' });
  const expression = String(app.calls.find((call) => call.operation === "or")?.args[0]);
  assert.equal(expression, "name.ilike.%alex  email eq%,email.ilike.%alex  email eq%");
});

test("customer endpoint validates input and serves successful option reads without caching", async () => {
  let calls = 0;
  let authorized = true;
  const route = load("../app/api/flows/customers/route.ts", {
    "@/lib/auth": { requireWorkspaceMember: async () => { if (!authorized) throw new Error("Authentication required"); } },
    "@/lib/flow-customers": customerTypes,
    "@/lib/data/flow-customers": { listFlowCustomers: async () => { calls++; return { companies: [{ id: companyId, name: "Company" }], hasMore: false }; } },
  }).GET;
  const response = await route(new Request("https://crm.example.com/api/flows/customers?kind=companies")) as Response;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).companies[0].id, companyId);
  assert.equal((await route(new Request("https://crm.example.com/api/flows/customers?companyId=bad")) as Response).status, 400);
  authorized = false;
  await assert.rejects(route(new Request("https://crm.example.com/api/flows/customers?kind=companies")), /Authentication required/);
  assert.equal(calls, 1);
});
