import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { defaultAiPolicy } from "../lib/ai-policy.ts";
import { salesReviewRange } from "../lib/ai/sales-review.ts";

const prompt = "Review the last seven days of accessible sales activity. Explain what moved forward, where opportunities stalled, and the three changes most likely to improve next week’s work.";
const now = new Date("2026-11-27T04:00:00Z");
test("the reported weekly prompt selects a rolling bounded report; named and compound actions stay on their original path", () => {
  assert.deepEqual(salesReviewRange(prompt, now), { since: "2026-11-20T04:00:00.000Z", until: now.toISOString(), label: "Last seven days", timezone: "Asia/Shanghai" });
  for (const text of [prompt + " Then draft an email.", "Review Acme's sales activity for the last seven days and send a quotation", "Review Acme's sales activity over the last seven days", "Review sales activity for Acme this week", "Review the last seven days of sales activity for this customer", "Review the last seven days of sales activity for our customer Acme", "Create an order", "Review sales activity last month"]) assert.equal(salesReviewRange(text, now), null, text);
  assert.equal(salesReviewRange("Review this week's sales activity", now)?.since, "2026-11-22T16:00:00.000Z");
  assert.equal(salesReviewRange("Review today's sales activity", now)?.since, "2026-11-26T16:00:00.000Z");
});

function recordsModule(role: string, disabled: string[] = [], fail = false) {
  const calls: Array<{ table: string; methods: Array<[string, ...unknown[]]> }> = [];
  const policy = defaultAiPolicy();
  for (const key of disabled) policy.data[key as keyof typeof policy.data] = false;
  const db = { from: (table: string) => {
    const call = { table, methods: [] as Array<[string, ...unknown[]]> }; calls.push(call);
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "lte", "order", "limit", "abortSignal"]) query[method] = (...args: unknown[]) => { call.methods.push([method, ...args]); return query; };
    query.then = (resolve: (value: unknown) => void) => resolve({ error: fail ? new Error("secret backend detail") : null, data: Array.from({ length: 51 }, (_, n) => ({ id: `record-${n}`, company: { id: "assigned", name: "Example" }, created_at: "2026-11-26T01:00:00Z", type: "email_received", data: { password: "DO_NOT_FORWARD", summary: "DO_NOT_FORWARD" }, document: { status: "draft", currency: "USD", bankToken: "DO_NOT_FORWARD", items: [] } })) });
    return query;
  } };
  const exports = {} as typeof import("../lib/ai/sales-review-records.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/ai/sales-review-records.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name: string) => name === "server-only" ? {} : name === "../data/ai-settings" ? { requireAiData: async () => policy } : name === "../supabase/admin" ? { createSupabaseAdmin: () => db } : assert.fail(`Unexpected dependency ${name}`), AbortSignal, Date, Error,
  });
  return { calls, policy, read: () => exports.readSalesReview({ id: "actor", role, workspaceId: "legacy" } as never, salesReviewRange(prompt, now)!, policy, AbortSignal.timeout(1000)) };
}

for (const role of ["admin", "operator", "bd_manager", "viewer"]) test(`${role} sales review uses five bounded, dated queries and preserves customer ownership`, async () => {
  const fixture = recordsModule(role); const result = await fixture.read();
  assert.equal(fixture.calls.length, 5);
  for (const call of fixture.calls) {
    assert.ok(call.methods.some(([key, value]) => key === "limit" && value === 51));
    assert.ok(call.methods.some(([key, column]) => key === "gte" && column === "created_at"));
    assert.ok(call.methods.some(([key]) => key === "abortSignal"));
    assert.equal(call.methods.some(([key, column, actor]) => key === "eq" && column === "company.pipeline.owner_id" && actor === "actor"), role !== "admin");
  }
  assert.equal(result.sources.orders.records.length, 50);
  assert.equal(result.sources.orders.records[0].status, "draft");
  assert.equal(result.sources.orders.coverage.truncated, true);
  assert.equal(result.coverage.externalMailboxHistoryScanned, false);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_FORWARD|bankToken|password/);
});

test("disabled AI data sources are not queried, and read failures remain unknown rather than zero activity", async () => {
  const restricted = recordsModule("operator", ["billing", "tasks"]);
  const empty = await restricted.read();
  assert.equal(restricted.calls.length, 0);
  assert.equal(empty.sources.invoices.coverage.available, false);
  const failing = await recordsModule("admin", [], true).read();
  assert.equal(failing.sources.orders.coverage.available, false);
  assert.doesNotMatch(JSON.stringify(failing), /secret backend detail/);
});
