import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { evaluationBudget, evaluationRate, EVALUATION_LIMIT_MICROS, EVALUATION_DURATION_MS } from "../lib/ai/evaluation-budget.ts";
import { quoteAiBudget } from "../lib/ai/budget.ts";

const rate = { input: .0000003, output: .0000025, context: 1_000_000, webSearch: 0 };
const body = { model: "google/gemini-3.5-flash-lite", input: "Synthetic", max_output_tokens: 1000 };
const init = { method: "POST", body: JSON.stringify(body) };
const endpoint = "https://ai-gateway.vercel.sh/v1/responses";
function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "filazoo-eval-"));
  t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(directory.includes("filazoo-eval-")); rmSync(directory, { recursive: true, force: true }); });
  return join(directory, "budget.json");
}
test("evaluation reserves before sending and survives restart without resetting its deadline or allowance", async t => {
  const path = fixture(t);
  const budget = evaluationBudget(path, () => 1000);
  const guarded = budget.fetch(async () => rate, async () => {
    const disk = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(Object.values(disk.pending)[0], quoteAiBudget(body, rate).reservedMicros);
    return Response.json({ usage: { input_tokens: 100, output_tokens: 10 } });
  });
  await guarded(endpoint, init);
  assert.equal(budget.snapshot().usedMicros, 55);
  const resumed = evaluationBudget(path, () => 5000).snapshot();
  assert.equal(resumed.usedMicros, 55); assert.equal(resumed.startedAt, 1000);
  assert.equal(resumed.endsAt, 1000 + EVALUATION_DURATION_MS);
});
test("interrupted and missing-usage calls retain their whole reservation across restarts", async t => {
  const path = fixture(t);
  const budget = evaluationBudget(path);
  const lost = budget.fetch(async () => rate, async () => { throw new Error("connection lost"); });
  await assert.rejects(lost(endpoint, init), /connection lost/);
  assert.equal(budget.snapshot().usedMicros, quoteAiBudget(body, rate).reservedMicros);
  const resumed = evaluationBudget(path);
  await resumed.fetch(async () => rate, async () => Response.json({}))(endpoint, init);
  assert.equal(resumed.snapshot().usedMicros, 2 * quoteAiBudget(body, rate).reservedMicros);
});
test("concurrent calls cannot spend the same final allowance and stopped calls never reach the provider", async t => {
  const path = fixture(t);
  const quote = quoteAiBudget(body, rate).reservedMicros;
  evaluationBudget(path);
  const state = JSON.parse(readFileSync(path, "utf8")); state.chargedMicros = EVALUATION_LIMIT_MICROS - quote;
  writeFileSync(path, JSON.stringify(state));
  const budget = evaluationBudget(path);
  let calls = 0;
  const guarded = budget.fetch(async () => rate, async () => { calls++; return Response.json({}); });
  const results = await Promise.allSettled([guarded(endpoint, init), guarded(endpoint, init), guarded(endpoint, init)]);
  assert.equal(calls, 1); assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(budget.snapshot().usedMicros, EVALUATION_LIMIT_MICROS);
  assert.ok(budget.snapshot().usedMicros < 5_000_000);
});
test("expired, aborted, malformed and unpriced requests fail closed", async t => {
  const path = fixture(t);
  let now = 1;
  const budget = evaluationBudget(path, () => now);
  let calls = 0;
  const guarded = budget.fetch(async () => rate, async () => { calls++; return Response.json({}); });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(guarded(endpoint, { ...init, signal: abort.signal }));
  for (const url of ["http://ai-gateway.vercel.sh/v1/responses", "https://example.com/v1/responses", "https://ai-gateway.vercel.sh/v1/chat/completions"]) await assert.rejects(guarded(url, init));
  for (const changes of [{ model: "unpriced" }, { stream: true }, { service_tier: "priority" }, { tools: [{ type: "web_search" }] }, { provider: "unknown" }]) await assert.rejects(guarded(endpoint, { ...init, body: JSON.stringify({ ...body, ...changes }) }));
  now += EVALUATION_DURATION_MS;
  await assert.rejects(guarded(endpoint, init), /time or total cost/);
  assert.equal(calls, 0);
});
test("an underquoted response halts further paid calls instead of releasing uncertain money", async t => {
  const budget = evaluationBudget(fixture(t)); let calls = 0;
  const guarded = budget.fetch(async () => rate, async () => { calls++; return Response.json({ usage: { input_tokens: 99999999, output_tokens: 99999999 } }); });
  await assert.rejects(guarded(endpoint, init), /exceeded/);
  assert.equal(budget.snapshot().halted, true);
  await assert.rejects(guarded(endpoint, init)); assert.equal(calls, 1);
  assert.equal(budget.snapshot().usedMicros, quoteAiBudget(body, rate).reservedMicros);
});
test("invalid or raised saved budgets never silently create fresh spending authority", t => {
  const path = fixture(t); evaluationBudget(path);
  const state = JSON.parse(readFileSync(path, "utf8")); state.limitMicros = 10_000_000;
  writeFileSync(path, JSON.stringify(state)); assert.throws(() => evaluationBudget(path), /invalid/);
  writeFileSync(path, "broken"); assert.throws(() => evaluationBudget(path));
});
test("pricing covers maximum context, cache-write and regional tiers and rejects invalid prices", () => {
  const price = evaluationRate({ context_window: 1000000, pricing: { input: "0.0000001", output: "0.0000005", input_cache_write_tiers: [{ cost: "0.0000006" }], regional: { us: { input: "0.0000007", output_tiers: [{ cost: "0.000003" }] } } } });
  assert.equal(price.input, .0000007); assert.equal(price.output, .000003);
  for (const invalid of ["NaN", "Infinity", "-1", "0", ""]) assert.throws(() => evaluationRate({ context_window: 1000, pricing: { input: invalid, output: ".01" } }));
});
test("native research verification envelopes share the same cap and remain reserved until settled", t => {
  const path = fixture(t), budget = evaluationBudget(path);
  const reservation = budget.reserveExternal(250000);
  assert.equal(budget.snapshot().usedMicros, 250000);
  assert.equal(evaluationBudget(path).snapshot().usedMicros, 250000);
  reservation.settle(250000);
  assert.equal(budget.snapshot().usedMicros, 250000);
  assert.throws(() => reservation.settle(0), /Invalid/);
  assert.throws(() => budget.reserveExternal(5_000_000), /limit/);
});
