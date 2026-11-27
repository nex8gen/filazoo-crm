import assert from "node:assert/strict";
import test from "node:test";
import { dailyWorkCases, dailyEvaluationData, dailyFormatGuides } from "../scripts/daily-work-evaluation-cases.ts";
import { assessDailyAnswer } from "../lib/ai/daily-work-evaluation.ts";
import { readFileSync } from "node:fs";

test("the daily evaluation covers all 100 prompts with grounded references and task-specific formats", () => {
  assert.equal(dailyWorkCases.length, 100);
  assert.deepEqual(dailyWorkCases.map(row => row.id), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(new Set(dailyWorkCases.map(row => row.category)).size, 10);
  assert.equal(new Set(dailyWorkCases.map(row => row.prompt)).size, 100);
  for (const row of dailyWorkCases) {
    assert.ok(row.referenceAnswer.length > 80, `Case ${row.id} needs an actual reference answer.`);
    assert.ok(dailyFormatGuides[row.format]);
    assert.ok(row.checks.length, `Case ${row.id} needs a business-specific check.`);
  }
});

test("smoke assessment catches fabricated execution and internal protocols without claiming semantic certification", () => {
  const result = assessDailyAnswer(dailyWorkCases[0], "I have sent the email and updated the customer. FILAZOO_ACTIONS_JSON: []");
  assert.equal(result.checks.find(row => row.label === "No fabricated execution")?.passed, false);
  assert.equal(result.checks.find(row => row.label === "No internal protocol leakage")?.passed, false);
  assert.match(result.limitations, /does not establish factual accuracy/);
  assert.equal(assessDailyAnswer(dailyWorkCases[0], "The customer claims the payment was sent, but it has not been recorded.").checks.find(row => row.label === "No fabricated execution")?.passed, true);
});

test("draft assessment rejects analyst scaffolding and accepts clean customer-facing wording", () => {
  const scenario = dailyWorkCases[22];
  assert.equal(scenario.format, "draft");
  assert.equal(assessDailyAnswer(scenario, "## Analysis\n\nShipping is not confirmed; we need to check it.").checks.find(row => row.label === "Copy-ready draft")?.passed, false);
  assert.equal(assessDailyAnswer(scenario, scenario.referenceAnswer).checks.find(row => row.label === "Copy-ready draft")?.passed, true);
});

test("fixture financial and document conflicts are explicit regression traps", () => {
  const invoice = dailyEvaluationData.invoices[0], order = dailyEvaluationData.orders[0];
  assert.equal(invoice.totalMinor - invoice.paidMinor, invoice.outstandingMinor);
  assert.equal(invoice.outstandingMinor, 160000);
  assert.notEqual(invoice.unitPriceMinor, order.agreedUnitPriceMinor);
  assert.notEqual(invoice.quantity, order.invoicedQuantity);
  assert.equal(dailyEvaluationData.emails.find(row => row.source === "E9")?.body.includes("depends"), true);
  assert.ok(dailyWorkCases[53].referenceAnswer.includes("issued"));
});

test("evaluation sends evidence and requests, never reference answers or rubric hints, to the answering model", () => {
  const source = readFileSync(new URL("../scripts/evaluate-daily-work.ts", import.meta.url), "utf8");
  const prompt = source.slice(source.indexOf("output = await generateGatewayText"), source.indexOf("} catch (caught)"));
  assert.match(prompt, /scenario\.prompt/);
  assert.doesNotMatch(prompt, /referenceAnswer|scenario\.checks|dailyFormatGuides/);
  assert.doesNotMatch(source, /from ["'].*(?:supabase|agent-execution|crm-execution|budget-server)/);
});
