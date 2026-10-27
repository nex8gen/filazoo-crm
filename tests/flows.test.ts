import assert from "node:assert/strict";
import test from "node:test";
import { defaultFlowInput, flowInputSchema } from "../lib/flows.ts";
import { calculateWaitUntil, simulateFlow, triggerMatches, flowConversationPath, nextBusinessWindow, type FlowFacts } from "../lib/flow-engine.ts";
import { buildFlowEmail, signTracking, verifyTracking } from "../lib/flow-tracking.ts";

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

test("resume time never shortens the configured wait", () => {
  assert.equal(calculateWaitUntil({ amount: 4, unit: "hours", resumeAt: "09:00" }, new Date("2026-10-20T08:00:00Z")).toISOString(), "2026-10-21T09:00:00.000Z");
});

test("multiple simulated waits accumulate", () => {
  const result = simulateFlow({ ...defaultFlowInput, steps: [
    { type: "wait", config: { amount: 1, unit: "hours" } },
    { type: "wait", config: { amount: 2, unit: "hours" } },
  ] }, facts, new Date("2026-10-20T08:00:00Z"));
  assert.match(result.trace[1].detail, /2026-10-20T11:00:00/);
});

test("a simulated category change affects subsequent conditions", () => {
  const result = simulateFlow({ ...defaultFlowInput, steps: [
    { type: "change_category", config: { category: "No action" } },
    { type: "if_condition", config: { field: "category_is", category: "No action", action: "stop_flow" } },
    { type: "create_task", config: { title: "Must not run", assigneeType: "owner", dueInDays: 0 } },
  ] }, facts);
  assert.equal(result.terminal, "stopped");
  assert.equal(result.trace.some((entry) => entry.type === "create_task"), false);
  assert.equal(facts.category, "Interested");
});

test("reply protection stops simulated sends", () => {
  const result = simulateFlow({ ...defaultFlowInput, steps: [defaultFlowInput.steps[1]] }, { ...facts, customerReplied: true });
  assert.equal(result.terminal, "stopped");
});

test("invalid times, templates, branch categories and assignees are rejected", () => {
  for (const step of [
    { type: "wait", config: { amount: 2, unit: "hours", resumeAt: "25:99" } },
    { type: "send_email", config: { templateId: "invented", mailboxId: "default", replyInThread: true } },
    { type: "if_condition", config: { field: "category_is", action: "stop_flow" } },
    { type: "create_task", config: { assigneeType: "user", dueInDays: 0, title: "Task" } },
  ]) assert.equal(flowInputSchema.safeParse({ ...defaultFlowInput, steps: [step] }).success, false);
});

test("all company filters must match", () => {
  for (const config of [{ country: "UK" }, { companyStatus: "customer" }, { pipelineStage: "won" }, { minFitScore: 9 }]) {
    assert.equal(triggerMatches("email_received", config, { type: "email_received", conversationId: "thread" }, facts), false);
  }
});

const runId = "00000000-0000-4000-a000-000000000001";
const stepId = "00000000-0000-4000-a000-000000000002";
test("alert links resolve company events and encode email conversation IDs", () => {
  assert.equal(flowConversationPath(`company:${runId}:pipeline`), `/companies/${runId}`);
  assert.equal(flowConversationPath("message:<customer@example.com>"), "/emails?thread=message%3A%3Ccustomer%40example.com%3E");
});
test("tracking links are signed, expire, and reject tampering", () => {
  const payload = { runId, stepId, kind: "click" as const, target: "https://filazoo.com/catalog", expires: Date.now() + 60000 };
  const token = signTracking(payload, "test-secret");
  assert.deepEqual(verifyTracking(token, "test-secret"), payload);
  assert.equal(verifyTracking(token, "wrong-secret"), null);
  assert.equal(verifyTracking(`${token}modified`, "test-secret"), null);
  assert.equal(verifyTracking(signTracking({ ...payload, expires: 0 }, "test-secret"), "test-secret"), null);
  assert.equal(verifyTracking(signTracking({ ...payload, target: "javascript:alert(1)" }, "test-secret"), "test-secret"), null);
});

test("email settings add preheader, open pixel, click links and UTM tags", () => {
  const content = buildFlowEmail({ body: "Hello <buyer>\nhttps://filazoo.com/catalog", config: { preheader: "Your <quote>" }, runId, stepId, flowId: "flow", appUrl: "https://crm.example.com", secret: "secret" });
  assert.match(content.html, /Your &lt;quote&gt;/);
  assert.match(content.html, /Hello &lt;buyer&gt;/);
  assert.match(content.html, /<img/);
  const link = new URL(content.text.split("\n")[1]);
  const decoded = verifyTracking(link.searchParams.get("token")!, "secret");
  assert.equal(decoded?.kind, "click");
  assert.match(decoded?.target || "", /utm_campaign=flow/);
});

test("tracking toggles remove all tracking when disabled", () => {
  const content = buildFlowEmail({ body: "https://filazoo.com/catalog", config: { trackOpens: false, trackClicks: false, utmTracking: false }, runId, stepId, flowId: "flow", appUrl: "https://crm.example.com", secret: "secret" });
  assert.equal(content.text, "https://filazoo.com/catalog");
  assert.doesNotMatch(content.html, /<img|\/api\/flows\/track|utm_/);
});

test("minute, hour and calendar-day waits retain their configured durations", () => {
  const from = new Date("2026-10-19T10:15:00Z");
  for (const [unit, milliseconds] of [["minutes", 60_000], ["hours", 3600_000], ["days", 86400_000]] as const) {
    assert.equal(calculateWaitUntil({ amount: 3, unit }, from).getTime() - from.getTime(), 3 * milliseconds);
  }
});

test("business-time minute and hour waits exclude the whole weekend", () => {
  assert.equal(calculateWaitUntil({ amount: 90, unit: "minutes", businessDays: true }, new Date("2026-10-23T23:00:00Z")).toISOString(), "2026-10-26T00:30:00.000Z");
  assert.equal(calculateWaitUntil({ amount: 48, unit: "hours", businessDays: true }, new Date("2026-10-23T12:00:00Z")).toISOString(), "2026-10-27T12:00:00.000Z");
});

test("business windows use the same UTC boundaries in previews and live execution", () => {
  assert.equal(nextBusinessWindow(new Date("2026-10-23T16:59:00Z")), null);
  assert.equal(nextBusinessWindow(new Date("2026-10-23T17:00:00Z"))?.toISOString(), "2026-10-26T09:00:00.000Z");
  for (const type of ["send_email", "ai_auto_reply"] as const) {
    const config = type === "send_email" ? { ...defaultFlowInput.steps[1].config, sendWindow: "business_hours" } : { ...defaultFlowInput.steps[1].config, sendWindow: "business_hours" };
    assert.equal(simulateFlow({ ...defaultFlowInput, steps: [{ type, config }] }, facts, new Date("2026-10-23T17:01:00Z")).trace[0].scheduledAt, "2026-10-26T09:00:00.000Z");
  }
});
