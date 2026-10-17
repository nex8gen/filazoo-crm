import assert from "node:assert/strict";
import test from "node:test";
import { defaultFlowInput, flowInputSchema } from "../lib/flows.ts";
import { calculateWaitUntil, simulateFlow, triggerMatches, type FlowFacts } from "../lib/flow-engine.ts";

const facts: FlowFacts = { customerReplied: false, openedEmail: false, clickedLink: false, category: "Interested", segment: "Print farm", country: "US", companyStatus: "qualified", pipelineStage: "interested", fitScore: 8 };

test("the shipped 3-step follow-up is a valid flow", () => {
  const parsed = flowInputSchema.safeParse(defaultFlowInput);
  assert.equal(parsed.success, true);
  assert.equal(defaultFlowInput.steps.length, 3);
});

test("send email steps require a template and mailbox", () => {
  const parsed = flowInputSchema.safeParse({
    ...defaultFlowInput,
    steps: [{ type: "send_email", config: { templateId: "", mailboxId: "", replyInThread: true } }],
  });
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues[0]?.message ?? "", /too small|complete/i);
});

test("flows require at least one ordered step", () => {
  const parsed = flowInputSchema.safeParse({ ...defaultFlowInput, steps: [] });
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues[0]?.message ?? "", /at least one step/i);
});

test("company segment triggers use the same CRM segment and profile filters", () => {
  assert.equal(triggerMatches("company_segment_changed", { segment: "Print farm", country: "US", minFitScore: 7 }, { type: "company_segment_changed", conversationId: "company:1", segment: "Print farm" }, facts), true);
  assert.equal(triggerMatches("company_segment_changed", { segment: "Reseller" }, { type: "company_segment_changed", conversationId: "company:1", segment: "Print farm" }, facts), false);
});

test("business-day waits skip weekends and honor resume time", () => {
  const friday = new Date("2026-10-16T15:00:00.000Z");
  assert.equal(calculateWaitUntil({ amount: 1, unit: "days", businessDays: true, resumeAt: "09:00" }, friday).toISOString(), "2026-10-19T09:00:00.000Z");
});

test("condition branches can skip the next action and stop later", () => {
  const result = simulateFlow({
    ...defaultFlowInput,
    steps: [
      { type: "if_condition", config: { field: "category_is", category: "Interested", action: "skip_next", unmatchedAction: "continue", lookbackDays: 7 } },
      { type: "send_email", config: { templateId: "helpful_reminder", mailboxId: "default", replyInThread: true } },
      { type: "stop", config: { reason: "Qualified path complete", outcome: "completed" } },
    ],
  }, facts);
  assert.equal(result.trace.some((entry) => entry.type === "send_email" && entry.status === "skipped"), true);
  assert.equal(result.terminal, "stopped");
});
