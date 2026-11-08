import { createHash } from "node:crypto";
import { preparedAgentActionSchema, type AgentActionResult, type AgentProposal, type PreparedAgentAction } from "./agent-actions.ts";
import { workflowResultIds, type PreparedWorkflow, type WorkflowStep } from "./workflow-schema.ts";

export type WorkflowChild = { proposal: AgentProposal; status: string; result: AgentActionResult & Record<string, unknown> };
export type WorkflowOutcome = AgentActionResult & { workflowPaused?: boolean; workflowCancelled?: boolean; stage: string };
export function workflowChildId(parent: string, step: string) {
  const hex = createHash("sha256").update(`filazoo-workflow:${parent}:${step}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The engine never retries a mutation. Stored child claims/results own execution. */
export async function runStoredWorkflow(input: {
  id: string; action: PreparedWorkflow; deadline?: number;
  load: (id: string) => Promise<WorkflowChild | null>;
  prepare: (step: WorkflowStep, results: Record<string, Record<string, unknown>>) => Promise<{ action: PreparedAgentAction; approvalMode: "ask" | "auto" }>;
  store: (proposal: AgentProposal, refreshExpired?: boolean) => Promise<WorkflowChild>;
  apply: (proposal: AgentProposal, approval: "manual" | "auto") => Promise<AgentActionResult | void>;
  checkpoint: (result: WorkflowOutcome) => Promise<void>;
}) {
  const results: Record<string, Record<string, unknown>> = {};
  const steps: NonNullable<AgentActionResult["workflow"]>["steps"] = [];
  let href: string | undefined;
  function outcome(stage: string, extra: Partial<WorkflowOutcome> = {}): WorkflowOutcome {
    return { stage, workflow: { completed: steps.filter(step => step.status === "completed").length, total: input.action.steps.length, steps: [...steps] }, href, canResume: true, ...extra };
  }
  for (const step of input.action.steps) {
    const id = workflowChildId(input.id, step.id);
    await input.checkpoint(outcome("workflow_running"));
    if (input.deadline && Date.now() > input.deadline) {
      const paused = outcome("workflow_ready", { workflowPaused: true, success: "Progress saved. Continuing the remaining work." });
      await input.checkpoint(paused); return paused;
    }
    let child = await input.load(id);
    let reviewed = input.action.preparedSteps.find(value => value.step === step.id);
    if (child?.status === "expired") {
      const fresh = await input.prepare(step, results);
      child = await input.store({ id, action: fresh.action, approvalMode: fresh.approvalMode, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }, true);
      reviewed = undefined; // Changed/fresh details need their own current review.
    }
    if (!child) {
      const prepared = reviewed ?? await input.prepare(step, results);
      const action = preparedAgentActionSchema.parse(prepared.action);
      if (action.type === "run_workflow") throw new Error("Nested workflows are not supported.");
      child = await input.store({ id, action, approvalMode: prepared.approvalMode, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    }
    if (child.status === "pending" && (reviewed || child.proposal.approvalMode === "auto")) {
      let response: AgentActionResult | void = undefined;
      try { response = await input.apply(child.proposal, reviewed ? "manual" : "auto"); }
      catch { /* Reconcile a lost response with the same child execution lock. */ }
      // A lost response is reconciled with the same stored child, never replayed.
      child = await input.load(id);
      if (!child) throw new Error("Unable to read the saved workflow step result.");
      if (child.status === "pending" && response?.error) child = { ...child, result: { ...child.result, error: response.error, status: "unknown" } };
    }
    steps.push({ id: step.id, tool: step.tool, status: child.status, ...(child.result.href ? { href: child.result.href } : {}) });
    if (child.status === "declined") {
      const declined = outcome("cancelled", { workflowCancelled: true, canResume: false, success: "Workflow stopped after its step was declined." });
      await input.checkpoint(declined); return declined;
    }
    if (child.status !== "completed") {
      const paused = outcome("workflow_waiting", { workflowPaused: true, awaitingAction: child.proposal, awaitingResult: { ...child.result, ...(child.status === "pending" ? {} : { status: child.status }) },
        success: child.status === "pending" ? "The next step is ready for review." : child.status === "running" ? "Waiting for the saved step result." : "Progress saved. The current step needs attention before dependent work can continue." });
      await input.checkpoint(paused); return paused;
    }
    results[step.id] = Object.fromEntries((workflowResultIds[step.tool] ?? []).flatMap(key => typeof child.result[key] === "string" ? [[key, child.result[key]]] : []));
    href = child.result.href ?? href;
  }
  const completed = outcome("completed", { canResume: false, success: `Completed all ${steps.length} workflow steps.` });
  await input.checkpoint(completed);
  return completed;
}
