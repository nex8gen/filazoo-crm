import assert from "node:assert/strict";
import test from "node:test";
import { formatCredits } from "../lib/billing/credits.ts";
import { orderProduct } from "../lib/billing/plans.ts";
import { createBudgetedAiFetch } from "../lib/ai/budget-fetch.ts";
import { AiBudgetError } from "../lib/ai/budget.ts";

test("order prices are versioned and seat quantities cannot reprice a legacy contract", () => {
  const legacy = { plan_id: "starter", catalog_version: 1, seats: 99 } as const;
  assert.equal(orderProduct(legacy)?.amountFen, 9900);
  assert.equal(orderProduct({ plan_id: "team" })?.amountFen, 29900);
  assert.equal(orderProduct({ plan_id: "starter", catalog_version: 2, seats: 3 })?.amountFen, 41700);
  assert.equal(orderProduct({ plan_id: "pro", catalog_version: 2, seats: 2 })?.amountFen, 55800);
  assert.equal(orderProduct({ plan_id: "credits_3000", catalog_version: 2, kind: "credits", seats: 1 })?.amountFen, 6900);
  for (const seats of [0,-1,0.5,101,NaN,Infinity]) assert.equal(orderProduct({ plan_id: "pro", catalog_version: 2, seats }), undefined);
  assert.equal(orderProduct({ plan_id: "team", catalog_version: 2 }), undefined);
});

test("fractional credits preserve ledger precision rather than rounding every call up", () => {
  assert.equal(formatCredits(1), "0.001");
  assert.equal(formatCredits(1000), "1");
  assert.equal(formatCredits(1234567), "1,234.567");
  assert.equal(formatCredits(0), "0");
});

test("an exhausted commercial wallet blocks paid calls even when local safety caps are raised", async () => {
  let sent = 0;
  const fetcher = createBudgetedAiFetch("verified-member", {
    async reserve(userId, _model, micros) { assert.equal(userId, "verified-member"); assert.ok(micros > 0); return { allowed: false, reason: "credits_exhausted" }; },
    async settle() { assert.fail("A denied call must not settle a nonexistent reservation"); },
  }, async () => ({ input: 0.0000001, output: 0.0000004, context: 100000, webSearch: 0.01 }), async () => { sent++; return Response.json({}); });
  await assert.rejects(fetcher("https://ai-gateway.vercel.sh/v1/responses", { method: "POST", body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", input: "Draft an email", max_output_tokens: 100 }) }), (error: unknown) => error instanceof AiBudgetError && error.status === 429 && /AI credits/.test(error.message) && /CRM remains available/.test(error.message));
  assert.equal(sent, 0);
});
