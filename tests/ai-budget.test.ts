import test from "node:test";
import assert from "node:assert/strict";
import { quoteAiBudget, chargedAiBudget, budgetMeter, budgetFailure, AiBudgetError, type AiBudgetSummary } from "../lib/ai/budget.ts";
import { createBudgetedAiFetch, type AiBudgetStore } from "../lib/ai/budget-fetch.ts";
const rate = { input: .0000002, output: .00000075, context: 1050000, webSearch: .01 };
const body = { model: "openai/gpt-5-nano", input: "Hello", max_output_tokens: 1200 };
const endpoint = "https://ai-gateway.vercel.sh/v1/responses";
const init = { method: "POST", body: JSON.stringify(body) };

test("budget quote covers UTF-8 input, output, bounded web search and opaque images", () => {
  const q = quoteAiBudget(body, rate);
  assert.ok(q.reservedMicros >= 4096 * rate.input * 1e6 + 1200 * rate.output * 1e6);
  assert.ok(quoteAiBudget({ ...body, input: "浣犲ソ".repeat(1000) }, rate).reservedMicros > q.reservedMicros);
  const web = quoteAiBudget({ ...body, tools: [{ type: "web_search" }], max_tool_calls: 1 }, rate);
  assert.ok(web.reservedMicros > q.reservedMicros + 128000 * rate.input * 1e6);
  assert.ok(web.reservedMicros < 200000);
  assert.ok(quoteAiBudget({ ...body, input: [{ type: "input_image", image_url: "data:image/png;base64,abc" }] }, rate).reservedMicros > 200000);
  for (const invalid of [{ ...body, model: "unpriced" }, { ...body, max_output_tokens: 0 }, { ...body, tools: [{ type: "web_search" }] }, { ...body, tools: [{ type: "code_interpreter" }] }]) assert.throws(() => quoteAiBudget(invalid, rate), AiBudgetError);
});
test("actual settlement includes reasoning output and retains uncertain costs", () => {
  const q = quoteAiBudget(body, rate);
  assert.equal(chargedAiBudget({ usage: { input_tokens: 1000, output_tokens: 100 } }, rate, q, 200), 275);
  assert.equal(chargedAiBudget({}, rate, q, 500), q.reservedMicros);
  assert.equal(chargedAiBudget({}, rate, q, 200), q.reservedMicros);
  assert.equal(chargedAiBudget({}, rate, q, 401), 0);
  assert.throws(() => chargedAiBudget({ usage: { input_tokens: 999999999, output_tokens: 1 } }, rate, q, 200), AiBudgetError);
  assert.equal(budgetMeter(999, 100, "reset").percent, 100);
  assert.equal(budgetMeter(0, 100, "reset").percent, 0);
});

test("Nano is quoted and settled within the same enforced spending limits", async () => {
  const terra = { input: .00000125, output: .000005, context: 1050000, webSearch: .01 };
  const request = { ...body, model: "openai/gpt-5-nano" };
  let reserved = 0, charged = 0;
  const store: AiBudgetStore = {
    reserve: async (_owner, model, micros) => { assert.equal(model, request.model); reserved = micros; return { allowed: true, reservationId: "terra" }; },
    settle: async (_owner, id, micros) => { assert.equal(id, "terra"); charged = micros; },
  };
  const guarded = createBudgetedAiFetch("owner", store, async model => { assert.equal(model, request.model); return terra; }, async () => Response.json({ usage: { input_tokens: 1000, output_tokens: 100 } }));
  assert.equal((await guarded(endpoint, { ...init, body: JSON.stringify(request) })).status, 200);
  assert.equal(reserved, quoteAiBudget(request, terra).reservedMicros);
  assert.equal(charged, 1750);
  assert.ok(charged <= reserved);
});
test("denied allowance never reaches provider; trusted owner is used", async () => {
  let calls = 0;
  const store: AiBudgetStore = { reserve: async (owner) => { assert.equal(owner, "trusted-owner"); return { allowed: false, reason: "user_daily" }; }, settle: async () => { throw new Error("unexpected"); } };
  const guarded = createBudgetedAiFetch("trusted-owner", store, async () => rate, async () => { calls++; return Response.json({}); });
  await assert.rejects(guarded(endpoint, init), /daily AI allowance/);
  assert.equal(calls, 0);
  await assert.rejects(guarded("https://generativelanguage.googleapis.com", init), /not configured/);
});
test("provider response is returned once even if settlement fails", async () => {
  let calls = 0, settlements = 0;
  const store: AiBudgetStore = { reserve: async () => ({ allowed: true, reservationId: "id" }), settle: async (_owner, _id, micros) => { settlements++; assert.equal(micros, 275); throw new Error("DB unavailable"); } };
  const guarded = createBudgetedAiFetch("owner", store, async () => rate, async () => { calls++; return Response.json({ usage: { input_tokens: 1000, output_tokens: 100 } }); });
  assert.equal((await guarded(endpoint, init)).status, 200);
  assert.equal(calls, 1); assert.equal(settlements, 1);
});
test("network loss retains reservation; abort before sending releases it", async () => {
  const charges: number[] = [];
  const controller = new AbortController();
  let abort = false;
  const store: AiBudgetStore = { reserve: async () => { if (abort) controller.abort(); return { allowed: true, reservationId: "id" }; }, settle: async (_owner, _id, value) => { charges.push(value); } };
  const guarded = createBudgetedAiFetch("owner", store, async () => rate, async () => { throw new TypeError("connection lost"); });
  await assert.rejects(guarded(endpoint, init), /connection lost/);
  assert.equal(charges[0], quoteAiBudget(body, rate).reservedMicros);
  abort = true;
  await assert.rejects(guarded(endpoint, { ...init, signal: controller.signal }));
  assert.equal(charges[1], 0);
});
test("parallel requests reserve before sending and cannot reuse the same allowance", async () => {
  const cost = quoteAiBudget(body, rate).reservedMicros;
  let remaining = cost, calls = 0;
  const store: AiBudgetStore = { reserve: async () => { if (remaining < cost) return { allowed: false, reason: "user_daily" }; remaining -= cost; return { allowed: true, reservationId: "id" }; }, settle: async () => {} };
  const guarded = createBudgetedAiFetch("owner", store, async () => rate, async () => { calls++; return Response.json({}); });
  const result = await Promise.allSettled([guarded(endpoint, init), guarded(endpoint, init), guarded(endpoint, init)]);
  assert.equal(result.filter(item => item.status === "fulfilled").length, 1); assert.equal(calls, 1);
});

test("a reservation denied at 85% usage never claims the balance is exhausted or reaches the provider", async () => {
  for (const [reason, field] of [["user_daily", "daily"], ["workspace_daily", "workspaceDaily"], ["workspace_monthly", "monthly"]] as const) {
    const meter = budgetMeter(168001, 200000, "2026-11-05T16:00:00Z");
    assert.equal(meter.percent, 85);
    const largeRequest = { ...body, input: "customer details ".repeat(12000) };
    assert.ok(quoteAiBudget(largeRequest, rate).reservedMicros > meter.remainingMicros);
    const limits: AiBudgetSummary = { timezone: "Asia/Shanghai", members: 5, daily: meter, workspaceDaily: meter, monthly: meter };
    let calls = 0, reads = 0;
    const store: AiBudgetStore = {
      reserve: async () => ({ allowed: false, reason }),
      read: async owner => { assert.equal(owner, "trusted-owner"); reads++; return limits; },
      settle: async () => { throw new Error("Denied reservations must not settle"); },
    };
    const guarded = createBudgetedAiFetch("trusted-owner", store, async () => rate, async () => { calls++; return Response.json({}); });
    await assert.rejects(guarded(endpoint, { ...init, body: JSON.stringify(largeRequest) }), (error: Error) => {
      assert.match(error.message, /remaining.*too low for this request/);
      assert.doesNotMatch(error.message, /used up|exhausted/);
      return true;
    });
    assert.equal(reads, 1); assert.equal(calls, 0);
    limits[field] = budgetMeter(200000, 200000, "reset");
    assert.match(budgetFailure(reason, limits).message, /used up/);
    limits[field] = budgetMeter(0, 0, "reset");
    const paused = budgetFailure(reason, limits);
    assert.equal(paused.status, 403);
    assert.match(paused.message, /paused by a zero allowance/);
    assert.doesNotMatch(paused.message, /resets|wait/);
  }
  assert.equal(budgetMeter(0, 0, "reset").percent, 100);
});

test("an unavailable balance read keeps the original denial and never permits a paid retry", async () => {
  let calls = 0;
  const store: AiBudgetStore = {
    reserve: async () => ({ allowed: false, reason: "user_daily" }),
    read: async () => { throw new Error("private database error"); },
    settle: async () => {},
  };
  const guarded = createBudgetedAiFetch("trusted", store, async () => rate, async () => { calls++; return Response.json({}); });
  await assert.rejects(guarded(endpoint, init), (error: Error) => {
    assert.equal(error.name, "AiBudgetError");
    assert.match(error.message, /remaining daily AI allowance/);
    assert.doesNotMatch(error.message, /used up|private database/);
    return true;
  });
  assert.equal(calls, 0);
});

