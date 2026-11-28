import assert from "node:assert/strict";
import test from "node:test";
import { formatCredits } from "../lib/billing/credits.ts";
import { orderProduct, plans, seatPlans, planPrice } from "../lib/billing/plans.ts";
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

test("credit amounts always display whole numbers without changing fractional accounting", () => {
  assert.equal(formatCredits(1), "<1");
  assert.equal(formatCredits(999), "<1");
  assert.equal(formatCredits(1000), "1");
  assert.equal(formatCredits(1234567), "1,234");
  assert.equal(formatCredits(1986164), "1,986");
  assert.equal(formatCredits(3264022), "3,264");
  assert.equal(formatCredits(11735978), "11,735");
  assert.equal(formatCredits(15000000), "15,000");
  assert.equal(formatCredits(0), "0");
  const usage = { usedMicros: 1986164, remainingMicros: 3264022 };
  formatCredits(usage.usedMicros);
  formatCredits(usage.remainingMicros);
  assert.deepEqual(usage, { usedMicros: 1986164, remainingMicros: 3264022 });
});

test("package pricing includes its fixed users and preserves historical annual orders", () => {
  for (const plan of plans) {
    const annual = planPrice(plan, "annual"), monthly = planPrice(plan, "monthly");
    assert.equal(annual.amountFen, plan.annualMonthlyFen * 12);
    assert.equal(monthly.amountFen, plan.amountFen);
    assert.equal(annual.savingsFen, monthly.amountFen * 12 - annual.amountFen);
    assert.equal(orderProduct({ plan_id: plan.id, catalog_version: 4, kind: "subscription", period_months: 12, seats: plan.members })?.amountFen, annual.amountFen);
    for (const seats of [0, plan.members + 1, 100]) assert.equal(orderProduct({ plan_id: plan.id, catalog_version: 4, kind: "subscription", period_months: 1, seats }), undefined);
  }
  assert.deepEqual(plans.map(p => p.members), [1, 2, 5]);
  assert.deepEqual(plans.map(p => p.credits), [2000, 6000, 15000]);
  assert.deepEqual(plans.map(p => p.amountCents), [1900, 5900, 12900]);
  assert.deepEqual(plans.map(p => planPrice(p, "annual").amountCents), [18000, 58800, 130800]);
  for (const plan of seatPlans) {
    assert.equal(orderProduct({ plan_id: plan.id, catalog_version: 3, period_months: 12, seats: 3 })?.amountFen, plan.amountFen * 36);
    assert.equal(orderProduct({ plan_id: plan.id, catalog_version: 3, period_months: 1, seats: 3 })?.amountFen, plan.amountFen * 6 / 5 * 3);
  }
  for (const period_months of [0, 6, 13, NaN]) assert.equal(orderProduct({ plan_id: "pro", catalog_version: 4, kind: "subscription", period_months, seats: 2 }), undefined);
  assert.equal(orderProduct({ plan_id: "pro", catalog_version: 2, period_months: 12 }), undefined);
});

test("current packages have smaller product catalogs and email allowances without rewriting purchased v4 packages", () => {
  assert.deepEqual(plans.map(plan => [plan.companies, plan.products, plan.flows, plan.workflowEmails]), [
    [1000,100,5,1000], [5000,500,15,5000], [20000,2000,50,20000],
  ]);
  const current = orderProduct({ plan_id: 'business', catalog_version: 6, kind: 'subscription', period_months: 12, seats: 5 });
  const historical = orderProduct({ plan_id: 'business', catalog_version: 4, kind: 'subscription', period_months: 12, seats: 5 });
  assert.equal(current?.amountFen, historical?.amountFen);
  assert.equal(current && 'products' in current && current.products, 2000);
  assert.equal(historical && 'products' in historical && historical.products, 25000);
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
