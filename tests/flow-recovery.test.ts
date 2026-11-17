import assert from "node:assert/strict";
import test from "node:test";
import { flowRecoveryState, flowRunActionId } from "../lib/flow-recovery.ts";

test("failure attribution uses stable action IDs from the run snapshot", () => {
  assert.equal(flowRunActionId({ current_step: 2, context: { preparationRetry: { stepId: "nested-email" } } }), "nested-email");
  assert.equal(flowRunActionId({ current_step: 2, context: { executionCheckpoint: { stepId: "submitted-email" } } }), "submitted-email");
  assert.equal(flowRunActionId({ current_step: 1, context: { definition: JSON.stringify([{ id: "old-wait" }, { id: "nested-task" }]) } }), "nested-task");
  assert.equal(flowRunActionId({ current_step: 1, context: { definition: "invalid" } }), null);
  assert.equal(flowRunActionId({ current_step: 9 }), null);
});

test("only proven preparation failures can be retried; SMTP uncertainty and accepted sends require review", () => {
  for (const phase of ["preparing", "submitting", "accepted"]) {
    const result = flowRecoveryState({ status: "failed", context: { executionCheckpoint: { phase, stepId: "email" } }, flow_run_logs: [] });
    assert.equal(result.retryable, phase === "preparing");
  }
  assert.equal(flowRecoveryState({ status: "failed", flow_run_logs: [{ error: "Address is not verified", result: null, created_at: "2026-11-10" }] }).retryable, true);
  assert.equal(flowRecoveryState({ status: "failed", flow_run_logs: [{ error: "Execution was interrupted. Delivery may have started.", result: null, created_at: "2026-11-10" }] }).retryable, false);
  assert.equal(flowRecoveryState({ status: "done", flow_run_logs: [] }).retryable, false);
});
