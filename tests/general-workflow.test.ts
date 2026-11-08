import test from "node:test";
import assert from "node:assert/strict";
import { workflowActionSchema, preparedWorkflowSchema, validateWorkflowGraph, resolveWorkflowInput, workflowPolicyAction } from "../lib/ai/workflow-schema.ts";
import { runStoredWorkflow, workflowChildId, type WorkflowChild, type WorkflowOutcome } from "../lib/ai/workflow-runner.ts";
import { aiActionApproval, aiActionRequirements, defaultAiPolicy } from "../lib/ai-policy.ts";
import type { PreparedAgentAction } from "../lib/ai/agent-actions.ts";
import { agentCapabilities } from "../lib/ai/capabilities.ts";
import { evaluationCases } from "../scripts/agent-evaluation-cases.ts";
import { defaultFlowInput } from "../lib/flows.ts";
import { portableToolSchema } from "../lib/ai/tool-schema.ts";

const parent = "a1111111-1111-4111-8111-111111111111";
const companyId = "b2222222-2222-4222-8222-222222222222";
const taskId = "c3333333-3333-4333-8333-333333333333";
const company: PreparedAgentAction = { type: "create_company", company: { name: "Synthetic", country: "US", segment: "Printing", website: "", city: "", contactName: "", contactRole: "", contactEmail: "" } };
const task: PreparedAgentAction = { type: "crm_action", operation: { op: "create_task", companyId, title: "Follow up", priority: "normal" }, target: "Synthetic", fingerprint: "a".repeat(64), preview: { title: "Follow up" } };
const plan = () => workflowActionSchema.parse({ type: "run_workflow", steps: [
  { id: "customer", tool: "create_company", input: company },
  { id: "task", tool: "create_task", input: { op: "create_task", title: "Follow up" }, bindings: [{ path: ["companyId"], step: "customer", result: "companyId" }] },
] });

function fixture(mode: "auto" | "ask" = "auto") {
  const action = preparedWorkflowSchema.parse({ ...plan(), preparedSteps: [{ step: "customer", action: company, approvalMode: "ask" }], messages: [{ role: "user", content: "Create the company, then a follow-up task for it." }] });
  const children = new Map<string, WorkflowChild>(), writes: string[] = [], snapshots: WorkflowOutcome[] = [];
  let lostResponse = false, defer = false;
  const run = (deadline?: number) => runStoredWorkflow({ id: parent, action, deadline,
    load: async id => children.get(id) ?? null,
    prepare: async (step, results) => { assert.equal(resolveWorkflowInput(step, results).companyId, companyId); return { action: task, approvalMode: mode }; },
    store: async proposal => { const stored = { proposal, status: "pending", result: {} }; children.set(proposal.id, stored); return stored; },
    apply: async proposal => {
      const stored = children.get(proposal.id)!;
      writes.push(proposal.id);
      if (defer) { stored.status = "running"; return; }
      stored.status = "completed";
      stored.result = { success: "Saved.", ...(proposal.action.type === "create_company" ? { companyId } : { taskId }), href: proposal.action.type === "create_company" ? `/companies/${companyId}` : "/tasks" };
      if (lostResponse) { lostResponse = false; throw new Error("Response lost after commit"); }
    },
    checkpoint: async snapshot => { snapshots.push(snapshot); },
  });
  return { action, children, writes, snapshots, run, loseNextResponse() { lostResponse = true; }, holdNextStep() { defer = true; } };
}

test("generic workflows bind only confirmed saved IDs and never repeat completed steps on resume", async () => {
  const f = fixture(); f.loseNextResponse();
  const result = await f.run();
  assert.equal(result.workflow?.completed, 2); assert.equal(result.workflowPaused, undefined);
  assert.deepEqual(f.writes, [workflowChildId(parent, "customer"), workflowChildId(parent, "task")]);
  await f.run(); assert.equal(f.writes.length, 2);
});

test("a dependent manual review pauses without claiming completion or executing unreviewed work", async () => {
  const f = fixture("ask");
  const paused = await f.run();
  assert.equal(paused.workflowPaused, true); assert.equal(paused.workflow?.completed, 1);
  assert.ok(paused.awaitingAction); assert.equal(paused.awaitingResult?.status, undefined, "pending reviews retain their approve controls");
  assert.equal(f.writes.length, 1);
  const child = f.children.get(paused.awaitingAction.id)!;
  child.status = "completed"; child.result = { success: "Task saved.", taskId };
  const completed = await f.run(); assert.equal(completed.workflow?.completed, 2); assert.equal(f.writes.length, 1);
});

test("expired dependent reviews are refreshed and require fresh approval", async () => {
  const f = fixture("ask");
  const paused = await f.run();
  const child = f.children.get(paused.awaitingAction!.id)!;
  child.status = "expired";
  const refreshed = await f.run();
  assert.equal(refreshed.awaitingAction?.id, child.proposal.id);
  assert.equal(f.children.get(child.proposal.id)?.status, "pending");
  assert.equal(refreshed.awaitingResult?.status, undefined);
  assert.equal(f.writes.length, 1);
});

test("a time boundary saves resumable progress without inventing a completed step", async () => {
  const f = fixture();
  const paused = await f.run(Date.now() - 1);
  assert.equal(paused.stage, "workflow_ready");
  assert.equal(paused.workflow?.completed, 0);
  assert.equal(paused.canResume, true);
  assert.equal(f.writes.length, 0);
  assert.equal((await f.run()).workflow?.completed, 2);
});

test("a running or failed child is reconciled rather than replayed; declining stops dependent work", async () => {
  const f = fixture(); f.holdNextStep();
  const pending = await f.run();
  assert.equal(pending.awaitingResult?.status, "running"); assert.equal(f.writes.length, 1);
  await f.run(); assert.equal(f.writes.length, 1);
  const stored = f.children.get(pending.awaitingAction!.id)!;
  stored.status = "failed"; stored.result = { error: "Delivery not confirmed." };
  const failed = await f.run(); assert.equal(failed.workflow?.completed, 0); assert.equal(f.writes.length, 1);
  stored.status = "declined";
  const stopped = await f.run(); assert.equal(stopped.workflowCancelled, true); assert.equal(stopped.canResume, false); assert.equal(f.children.size, 1);
});

test("workflow permissions are the union of every actual step and cannot bypass a denied operation", () => {
  const action = plan();
  const required = aiActionRequirements(action);
  assert.ok(required.actions.includes("customers")); assert.ok(required.actions.includes("tasks"));
  const policy = defaultAiPolicy(); policy.actions.tasks = "deny";
  assert.throws(() => aiActionApproval(policy, action, "auto"), /blocked/);
  assert.equal(workflowPolicyAction(action.steps[1]).operation?.op, "create_task");
});

test("bindings reject cycles, missing receipts, fake output fields, permissions, prototype paths and sparse arrays", () => {
  const action = plan();
  validateWorkflowGraph(action.steps);
  assert.throws(() => resolveWorkflowInput(action.steps[1], {}), /did not confirm/);
  for (const binding of [
    { path: ["companyId"], step: "task", result: "companyId" },
    { path: ["companyId"], step: "customer", result: "invoiceId" },
    { path: ["role"], step: "customer", result: "companyId" },
  ]) {
    const changed = plan(); changed.steps[1].bindings = [binding];
    assert.throws(() => validateWorkflowGraph(changed.steps));
  }
  for (const path of [["__proto__", "companyId"], ["companyIds", "999999999"]]) assert.equal(workflowActionSchema.safeParse({ ...action, steps: [action.steps[0], { ...action.steps[1], bindings: [{ path, step: "customer", result: "companyId" }] }] }).success, false);
  const exportStep = { ...action.steps[1], input: { selection: { companyIds: [] } }, bindings: [{ path: ["selection", "companyIds", "0"], step: "customer", result: "companyId" }] };
  validateWorkflowGraph([action.steps[0], exportStep]);
  assert.deepEqual(resolveWorkflowInput(exportStep, { customer: { companyId } }), { selection: { companyIds: [companyId] } });
});

test("all registered business tools compose into thousands of strictly validated two-step plans", () => {
  const cases = evaluationCases().filter(value => value.expectedTool && value.expectedTool !== "run_workflow");
  const capabilities = new Map(agentCapabilities().map(value => [value.name, value]));
  let checked = 0;
  for (const first of cases) for (const second of cases) {
    const steps = [first, second].map((entry, index) => {
      const action = entry.expected as { type: string; operation?: unknown };
      return { id: `step${index}`, tool: entry.expectedTool!, input: action.type === "crm_action" ? action.operation : action };
    });
    const parsed = workflowActionSchema.parse({ type: "run_workflow", steps });
    validateWorkflowGraph(parsed.steps);
    for (const step of parsed.steps) assert.doesNotThrow(() => capabilities.get(step.tool)!.action(step.input));
    aiActionRequirements(parsed);
    checked++;
  }
  assert.ok(checked >= 3_000);
});

test("recursive flow configuration has a portable presentation and retains authoritative server validation", () => {
  const capability = agentCapabilities().find(value => value.name === "create_flow")!;
  const presentation = JSON.stringify(portableToolSchema(capability.inputSchema));
  assert.doesNotMatch(presentation, /"\$ref"|"\$defs"/);
  assert.doesNotThrow(() => capability.action({ flow: defaultFlowInput }));
  assert.throws(() => capability.action({ flow: { ...defaultFlowInput, triggerConfig: { invalid: () => "not JSON" } } }));
});
