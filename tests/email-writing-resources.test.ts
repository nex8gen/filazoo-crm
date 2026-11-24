import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { defaultAiPolicy, restrictedAiContext, type AiPolicy } from "../lib/ai-policy.ts";
import { loadSummaryCatalog, summaryProductContext } from "../lib/ai/email-summary-products.ts";

function setup() {
  const reads: Array<{ table: string; columns: string; filters: Record<string, unknown>; limit: number }> = [];
  let companyId: string | null = "authorized-company";
  let failKnowledge = false;
  let facts = [{ title: "Samples", content: "Samples require review." }];
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../ai-policy": { restrictedAiContext },
    "./crm": { listProducts: async () => ({ mode: "live", products: [{ sku: "PLA", name: "PLA Basic", status: "Active", material: "PLA", colors: ["Black"], diameter: "1.75mm", weight: "1kg" }, { sku: "RETIRED", status: "Inactive" }] }) },
    "../ai/email-summary-products": { loadSummaryCatalog, summaryProductContext },
    "./email-customer-context": { readEmailCustomerContext: async (_viewer: unknown, mailbox: string, recipient: string) => {
      assert.equal(mailbox, "authorized-mailbox"); assert.equal(recipient, "buyer@example.test");
      reads.push({ table: "authorized-customer", columns: "", filters: {}, limit: 0 });
      return { companyId, customerProfile: { companyName: "Buyer", contactName: "Abe", country: "US", summary: "Private customer summary", interests: ["PLA"], fitScore: 99 } };
    } },
    "../supabase/admin": { createSupabaseAdmin: () => ({ from(table: string) {
      const read = { table, columns: "", filters: {} as Record<string, unknown>, limit: 0 }; reads.push(read);
      const query = {
        select(columns: string) { read.columns = columns; return query; },
        eq(key: string, value: unknown) { read.filters[key] = value; return query; },
        order() { return query; }, limit(value: number) { read.limit = value; return query; },
        async throwOnError() {
          if (table === "email_reply_knowledge" && failKnowledge) throw new Error("Knowledge unavailable");
          return { data: table === "email_reply_knowledge" ? facts : [{ title: "Investigate sample problem", notes: "Pending team investigation", status: "open", due_at: null }] };
        },
      }; return query;
    } }) },
  };
  const exports = {} as { loadEmailWritingResources: (viewer: unknown, mailbox: string, recipient: string, policy: AiPolicy) => Promise<Record<string, unknown>> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-writing-resources.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { reads, load: async (policy = defaultAiPolicy()) => JSON.parse(JSON.stringify(await exports.loadEmailWritingResources({ id: "actor" }, "authorized-mailbox", "buyer@example.test", policy))), noCompany: () => { companyId = null; }, fail: () => { failKnowledge = true; }, oversized: () => { facts = Array.from({ length: 101 }, () => ({ title: "Fact", content: "Policy" })); } };
}

test("writing resources use the authorized customer, active catalog, approved facts and own open customer tasks", async () => {
  const app = setup(); const result = await app.load();
  assert.deepEqual(result.customerProfile, { companyName: "Buyer", contactName: "Abe", country: "US", summary: "Private customer summary", interests: ["PLA"] });
  assert.equal(result.productCatalog.products.length, 1);
  assert.equal(result.productCatalog.products[0].sku, "PLA");
  const tasks = app.reads.find(read => read.table === "crm_tasks")!;
  assert.deepEqual(tasks.filters, { company_id: "authorized-company", status: "open", assigned_to: "actor" });
  assert.equal(tasks.limit, 51);
  assert.deepEqual(result.approvedBusinessFacts.records, [{ title: "Samples", content: "Samples require review." }]);
});

test("disabled customer, product, knowledge and task access prevents their reads", async () => {
  const app = setup(); const policy = defaultAiPolicy();
  policy.data.customers = false; policy.data.products = false; policy.data.knowledge = false; policy.data.tasks = false;
  const result = await app.load(policy);
  assert.equal(result.customerProfile, null);
  assert.equal(result.productCatalog.status, "disabled");
  assert.equal(result.approvedBusinessFacts.status, "disabled");
  assert.equal(result.openCustomerTasks.status, "disabled");
  assert.deepEqual(app.reads, []);
});

test("restricted policies withhold free text and unlinked customers never trigger a task scan", async () => {
  const app = setup(); const policy = defaultAiPolicy(); policy.data.billing = false;
  const result = await app.load(policy);
  assert.equal(result.customerProfile.summary, undefined);
  assert.equal(result.customerProfile.interests, undefined);
  assert.equal(result.openCustomerTasks.status, "disabled");
  assert.equal(app.reads.some(read => read.table === "crm_tasks"), false);
  const unlinked = setup(); unlinked.noCompany();
  assert.equal((await unlinked.load()).openCustomerTasks.status, "no_linked_customer");
  assert.equal(unlinked.reads.some(read => read.table === "crm_tasks"), false);
});

test("knowledge failure or lookup overflow cannot silently masquerade as complete context", async () => {
  const app = setup(); app.fail(); await assert.rejects(app.load(), /Knowledge unavailable/);
  const oversized = setup(); oversized.oversized(); await assert.rejects(oversized.load(), /too large/);
});
