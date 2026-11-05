import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../lib/shopify-leads.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("failed Shopify imports retain plain database errors without reaching automation", async () => {
  for (const [failure, expected] of [
    [{ message: "duplicate key value violates unique constraint", code: "23505" }, "duplicate key value violates unique constraint"],
    [new Error("Database connection timed out"), "Database connection timed out"],
    [{ message: " " }, "Shopify lead could not be saved."],
    [null, "Shopify lead could not be saved."],
  ] as const) {
    const writes: Array<Record<string, unknown>> = [];
    const db = { from(table: string) {
      assert.ok(["shopify_leads", "contacts"].includes(table), "No downstream CRM writes or automation after the lookup fails");
      let operation = "select";
      const query = {
        select() { return query; }, eq() { return query; },
        maybeSingle() { return query; },
        upsert() { operation = "upsert"; return query; },
        update(payload: Record<string, unknown>) { operation = "update"; writes.push(payload); return query; },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: null, error: table === "contacts" ? failure ?? { invalid: true } : null, operation }).then(resolve);
        },
      };
      return query;
    } };
    const exports = {} as { saveShopifyLead: (lead: Record<string, unknown>, id: string, shop: string) => Promise<{ ok: boolean; error: string }> };
    const dependencies: Record<string, unknown> = {
      "node:crypto": {}, "./env.ts": { env: {}, hasSupabaseConfig: () => true },
      "./supabase/admin.ts": { createSupabaseAdmin: () => db },
      "./lead-assignment.ts": { claimNextBdSalesManager: () => assert.fail("No assignment after failure") },
    };
    vm.runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, Error, Date });
    const result = await exports.saveShopifyLead({ customerId: "form:test", email: "fixture@example.test", tags: [], rawPayload: {}, createdAt: new Date().toISOString() }, "form:test", "example.test");
    assert.equal(result.ok, false);
    assert.equal(result.error, expected);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].status, "failed");
    assert.equal(writes[0].error_message, expected);
  }
});
