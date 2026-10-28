import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../lib/crm-model.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

const require = createRequire(import.meta.url);
const company = { id: "company-a", name: "Buyer", country: "China", city: "Shanghai", source: "manual", status: "new", contacts: [{ email: "primary@buyer.test", name: "Buyer", role: "Purchasing" }], company_profiles: [{ summary: "Needs PETG", fit_score: 80, interest_tags: ["PETG"] }], pipeline: [{ stage: "new", owner_id: "owner", currency: "USD", estimated_order_quantity: 10, estimated_value: 20 }] };
function setup(fail = false) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const db = { from: (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "or", "order", "range", "in"]) query[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return query; };
    query.then = (resolve: (value: unknown) => void) => resolve({
      data: table === "contacts" ? [{ email: "secondary@buyer.test", companies: company }] : table === "companies" ? [company] : [{ user_id: "owner", display_name: "Jane Sales" }],
      error: fail ? { message: "query failed" } : null,
    });
    return query;
  } };
  const exports = {} as { listInboxCompanies: (messages: InboxEmailItem[], assigned: Map<string, string> | null) => Promise<{ companies: Array<Record<string, unknown>> }> };
  const dependencies: Record<string, unknown> = { "../supabase/admin.ts": { createSupabaseAdmin: () => db }, "../crm-model.ts": model };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/inbox-companies.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name: string) => dependencies[name] ?? require(name),
  });
  return { ...exports, calls };
}
const message = (contact: string) => ({ id: contact, contact, company: "Unknown company" } as InboxEmailItem);

test("inbox context queries only actual correspondents and preserves secondary-address matches", async () => {
  const { listInboxCompanies, calls } = setup();
  const result = await listInboxCompanies([message("SECONDARY@BUYER.TEST")], null);
  const filters = calls.filter((call) => call.method === "or");
  assert.equal(filters.length, 1);
  assert.match(String(filters[0].args[0]), /email.ilike.*secondary@buyer.test/);
  assert.equal(calls.some((call) => call.table === "companies"), false, "No global company scan");
  assert.ok(result.companies.some((item) => item.email === "secondary@buyer.test"));
  assert.equal(result.companies[0].ownerName, "Jane Sales");
  assert.equal(result.companies[0].summary, "Needs PETG");
  for (const select of calls.filter((call) => call.method === "select")) {
    assert.equal(String(select.args[0]).includes("meta_leads"), false);
    assert.equal(String(select.args[0]).includes("emails("), false);
  }
});

test("assigned customer IDs avoid redundant address lookups and empty inboxes need no database queries", async () => {
  const loaded = setup();
  await loaded.listInboxCompanies([message("assigned@buyer.test")], new Map([["assigned@buyer.test", "company-a"]]));
  assert.equal(loaded.calls.some((call) => call.table === "contacts"), false);
  assert.ok(loaded.calls.some((call) => call.table === "companies" && call.method === "or" && String(call.args[0]).includes('id.eq."company-a"')));
  const empty = setup();
  assert.equal((await empty.listInboxCompanies([], null)).companies.length, 0);
  assert.equal(empty.calls.length, 0);
});

test("email filter values quote delimiters and escape wildcard characters", async () => {
  const { listInboxCompanies, calls } = setup();
  await listInboxCompanies([message('a_%",or@example.test')], null);
  const filter = String(calls.find((call) => call.table === "contacts" && call.method === "or")?.args[0]);
  assert.equal(filter, `email.ilike.${JSON.stringify('a\\_\\%",or@example.test')}`);
});

test("customer context failures surface without returning unrelated company data", async () => {
  await assert.rejects(setup(true).listInboxCompanies([message("secondary@buyer.test")], null), /Unable to load email customer context: query failed/);
});
