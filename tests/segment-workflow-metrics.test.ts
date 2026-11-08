import assert from "node:assert/strict";
import test from "node:test";
import { emptyWorkflowCounts, summarizeSegmentWorkflows, totalWorkflowCounts, workflowSegmentKey, type SegmentWorkflowDefinition, type SegmentWorkflowRun } from "../lib/segment-workflow-metrics.ts";

const flows: SegmentWorkflowDefinition[] = [
  { id: "business-flow", name: "Wholesale welcome", status: "live", trigger_config: { segment: "Wholesale" } },
  { id: "saved-flow", name: "Wholesale follow-up", status: "paused", trigger_config: { savedSegmentId: "saved-id", segment: "Wholesale" } },
];

test("saved segment identity takes precedence over its name and business triggers remain compatible", () => {
  assert.equal(workflowSegmentKey(flows[0].trigger_config), "business:Wholesale");
  assert.equal(workflowSegmentKey(flows[1].trigger_config), "saved-id");
  assert.equal(workflowSegmentKey({ savedSegmentId: "saved-id", segment: "Renamed audience" }), "saved-id");
  assert.equal(workflowSegmentKey({}), null);
});

test("run totals keep completed, active, stopped and failed separate across workflows", () => {
  const runs = ["active", "done", "cancelled", "failed"].map((status, i) => ({ id: String(i), flow_id: "business-flow", company_id: "same-company", status }));
  const metrics = summarizeSegmentWorkflows(flows, [...runs, runs[0], { id: "saved", flow_id: "saved-flow", company_id: "same-company", status: "active" }], []);
  assert.deepEqual(totalWorkflowCounts(metrics), { active: 2, blocked: 0, completed: 1, cancelled: 1, failed: 1, emailsSent: 0 });
  assert.equal(metrics[1].status, "paused");
});

test("email counts include only confirmed send logs from included runs and deduplicate message IDs", () => {
  const runs: SegmentWorkflowRun[] = [{ id: "run", flow_id: "business-flow", company_id: "customer", status: "done" }];
  const logs = [
    { id: "sent", run_id: "run", result: { action: "email_sent", messageId: "message" } },
    { id: "duplicate", run_id: "run", result: { action: "email_sent", messageId: "message" } },
    { id: "no-message-id", run_id: "run", result: { action: "email_sent", messageId: null } },
    { id: "open", run_id: "run", result: { action: "email_opened" } },
    { id: "dry", run_id: "run", result: { action: "email_dry_run" } },
    { id: "other-company", run_id: "excluded-run", result: { action: "email_sent" } },
  ];
  const metrics = summarizeSegmentWorkflows(flows, runs, logs);
  assert.equal(metrics[0].emailsSent, 2);
  assert.equal(metrics[1].emailsSent, 0);
});

test("large histories count every run and empty workflows retain zero metrics", () => {
  const runs = Array.from({ length: 2501 }, (_, i) => ({ id: String(i), flow_id: "business-flow", company_id: "customer", status: "active" }));
  const metrics = summarizeSegmentWorkflows(flows, runs, []);
  assert.equal(metrics[0].active, 2501);
  assert.deepEqual(totalWorkflowCounts([metrics[1]]), emptyWorkflowCounts());
  assert.deepEqual(summarizeSegmentWorkflows([], runs, []), []);
});

test("blocked journeys stay visible and do not inflate in-progress totals", () => {
  const result = summarizeSegmentWorkflows(flows, [{ id: "blocked", flow_id: "business-flow", company_id: "customer", status: "active", execution_state: "blocked" }], []);
  assert.equal(result[0].blocked, 1);
  assert.equal(result[0].active, 0);
  assert.equal(result[0].failed, 0);
});
