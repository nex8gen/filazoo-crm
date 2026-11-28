import assert from "node:assert/strict";
import test from "node:test";
import { parseEcbUsdCny, parseRechargeCredits, rechargeAmountFen, maxRechargeCredits } from "../lib/billing/recharge.ts";
import { orderProduct } from "../lib/billing/plans.ts";

test("custom recharges support whole quantities and round only the final payment up to fen", () => {
  const rate = 6_630_000;
  assert.equal(parseRechargeCredits("1"), 1);
  assert.equal(parseRechargeCredits("23456789"), 23456789);
  for (const input of ["0", "-1", "1.5", "1e3", " 1000", "", "01", "Infinity", "9007199254740993", null]) assert.equal(parseRechargeCredits(input), null);
  assert.equal(rechargeAmountFen(1, rate), 1);
  assert.equal(rechargeAmountFen(3000, rate), 1989);
  assert.equal(rechargeAmountFen(10000, rate), 6630);
  assert.equal(rechargeAmountFen(3001, rate), 1990);
  const max = maxRechargeCredits(rate);
  assert.ok(rechargeAmountFen(max, rate));
  assert.equal(rechargeAmountFen(max + 1, rate), null);
  for (const input of [-1, 0, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(rechargeAmountFen(input, rate), null);
  for (const rate of [0, -1, Infinity, 500, 51_000_001]) assert.equal(rechargeAmountFen(1000, rate), null);
});

test("the rate parser requires both currencies and a recent official source date", () => {
  const now = Date.parse("2026-11-28T01:00:00Z");
  const xml = `<Cube time='2026-11-27'><Cube currency='USD' rate='1.1'/><Cube rate='7.15' currency='CNY'/></Cube>`;
  assert.deepEqual(parseEcbUsdCny(xml, now), { sourceDate: "2026-11-27", baseRateMicros: 6_500_000 });
  for (const broken of [xml.replace("2026-11-27", "2026-11-01"), xml.replace("2026-11-27", "2026-12-01"), xml.replace("USD", "GBP"), xml.replace("7.15", "0"), "<error/>", "x".repeat(65537)]) assert.throws(() => parseEcbUsdCny(broken, now), /unavailable/);
});

test("new orders use immutable rate snapshots while old orders retain their historical price", () => {
  const order = { catalog_version: 5, plan_id: "credits_custom", kind: "credits", seats: 1, period_months: 1, credit_quantity: 12345, credit_rate_micros: 6_630_000 } as const;
  assert.equal(orderProduct(order)?.amountFen, 8185);
  assert.equal(orderProduct(order)?.name, "12,345 AI credits");
  assert.equal(orderProduct({ ...order, seats: 2 }), undefined);
  assert.equal(orderProduct({ ...order, kind: "subscription" }), undefined);
  assert.equal(orderProduct({ ...order, credit_quantity: 0 }), undefined);
  assert.equal(orderProduct({ ...order, period_months: 12 }), undefined);
  assert.equal(orderProduct({ plan_id: "credits_3000", catalog_version: 2, kind: "credits", seats: 1 })?.amountFen, 6900);
});
