import assert from "node:assert/strict";
import test from "node:test";
import { emptyActionPerformance, summarizeActionPerformance, type EmailPerformanceLog, type EmailPerformanceRun } from "../lib/flow-email-performance.ts";
import { blankStep, cloneFlowStep, defaultFlowInput, stepConfigSchemas, stepTypes, withFlowEmailIdentities } from "../lib/flows.ts";

const now = new Date("2026-11-19T12:00:00Z");
const log = (id: string, action: string, stepId: string, runId = id, extra = {}): EmailPerformanceLog => ({ id, run_id: runId, created_at: "2026-11-18T12:00:00Z", result: { action, stepId, ...extra } });
const run = (id: string, stepId: string, status = "active", context = {}): EmailPerformanceRun => ({ id, status, current_step: 0, context: { definition: JSON.stringify([{ id: stepId }]), ...context } });

test("all non-email action outcomes use durable identities and count each completed run once", () => {
  const events = ["task_created", "category_changed", "company_updated", "alert_created", "split_evaluated", "condition_evaluated", "stopped"];
  const logs = events.map((action, index) => log(String(index), action, `old-${index}`, `run-${index}`, { performanceId: `stable-${index}` }));
  const report = summarizeActionPerformance([...logs, ...logs, log("retry-success", "task_created", "old-0", "run-0", { performanceId: "stable-0" }), log("ignored", "ai_usage", "ai"), { ...log("old", "task_created", "old"), created_at: "2026-01-01T00:00:00Z" }], [run("run-0", "stable-0", "failed")], now);
  for (let index = 0; index < events.length; index++) assert.deepEqual(report[`stable-${index}`], { ...emptyActionPerformance(), completed: 1 });
  assert.equal(report["old-0"], undefined);
  assert.equal(report.old, undefined);
  assert.equal(report.ai, undefined);
});

test("current nested cursors distinguish queued, blocked, failed, skipped and completed actions", () => {
  const queued = run("queued", "replaced-task", "active", { definition: JSON.stringify([{ id: "replaced-task", config: { performanceId: "task" } }]) });
  const blocked = run("blocked", "other", "active", { preparationRetry: { stepId: "task" }, executionState: "blocked" });
  const failed = run("failed", "task", "failed");
  const report = summarizeActionPerformance([log("skip", "action_skipped", "task", "skip"), log("done", "task_created", "task", "done")], [queued, queued, blocked, failed, run("skip", "task"), run("done", "task")], now);
  assert.deepEqual(report.task, { completed: 1, waiting: 1, review: 2, skipped: 1 });
  assert.equal(report.other, undefined);
});

test("durable delays count waiting on the delay rather than the next action, including old delays", () => {
  const context = { executionCheckpoint: { stepId: "old-wait", performanceId: "wait", type: "wait" } };
  const delayed = { ...run("delay", "next-task", "active", context), next_run_at: "2026-11-20T12:00:00Z" };
  const waiting = log("waiting", "waiting", "old-wait", "delay", { performanceId: "wait", nextRunAt: delayed.next_run_at });
  const elapsed = log("elapsed", "waiting", "wait", "elapsed", { nextRunAt: "2026-11-18T15:00:00Z" });
  const report = summarizeActionPerformance([waiting, waiting, elapsed], [delayed], now);
  assert.deepEqual(report.wait, { completed: 1, waiting: 1, review: 0, skipped: 0 });
  assert.equal(report["next-task"], undefined);
  const old = summarizeActionPerformance([{ ...waiting, created_at: "2026-08-01T00:00:00Z" }], [delayed], now);
  assert.deepEqual(old.wait, { completed: 0, waiting: 1, review: 0, skipped: 0 });
});

test("all action schemas preserve reporting IDs across saves and clear IDs on copies, including splits", () => {
  const steps = stepTypes.map(type => {
    const step = blankStep(type);
    if (type === "send_email") step.config.templateId = "helpful_reminder";
    if (type === "internal_alert") step.config.userId = "member";
    return step;
  });
  const first = withFlowEmailIdentities({ ...defaultFlowInput, steps });
  const second = withFlowEmailIdentities({ ...first, steps: first.steps.map(step => ({ ...step, id: `new-${step.id}` })) });
  for (const [index, step] of second.steps.entries()) {
    assert.equal(stepConfigSchemas[step.type].parse(step.config).performanceId, steps[index].id);
    assert.equal(cloneFlowStep(step).config.performanceId, undefined);
  }
  const split = blankStep("split");
  const paths = split.config.paths as Array<{ steps: unknown[] }>;
  paths[0].steps = [steps.find(step => step.type === "create_task")!];
  const normalized = withFlowEmailIdentities({ ...defaultFlowInput, steps: [split] });
  const nested = (normalized.steps[0].config.paths as Array<{ steps: Array<{ config: { performanceId?: string } }> }>)[0].steps[0];
  assert.ok(nested.config.performanceId);
  const copied = cloneFlowStep(normalized.steps[0]);
  const copiedPaths = copied.config.paths as Array<{ steps: Array<{ config: { performanceId?: string } }> }>;
  assert.equal(copiedPaths[0].steps[0].config.performanceId, undefined);
});
