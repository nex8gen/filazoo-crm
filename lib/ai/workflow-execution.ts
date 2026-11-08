import "server-only";
import type { WorkspaceViewer } from "../auth";
import { getAiSettings } from "../data/ai-settings";
import { aiActionApproval } from "../ai-policy";
import { createSupabaseAdmin } from "../supabase/admin";
import { agentCapabilities } from "./capabilities";
import { assertDocumentIntent } from "./document-intent";
import { authorizeCrmOperation } from "./crm-execution";
import { preparedAgentActionSchema, type AgentPlanningContext, type AgentProposal } from "./agent-actions";
import type { WorkspaceAction } from "./workspace-assistant";
import { preparedWorkflowSchema, resolveWorkflowInput, validateWorkflowGraph, type WorkflowAction, type PreparedWorkflow } from "./workflow-schema";
import { runStoredWorkflow, type WorkflowChild, type WorkflowOutcome } from "./workflow-runner";

type Prepare = (action: WorkspaceAction) => Promise<AgentProposal>;
function actionFor(step: WorkflowAction["steps"][number], results: Record<string, Record<string, unknown>>, preview = false) {
  const capability = agentCapabilities().find(value => value.name === step.tool);
  if (!capability || step.tool === "run_workflow") throw new Error(`Choose a registered CRM tool for step ${step.id}.`);
  return capability.action(resolveWorkflowInput(step, results, preview));
}

export async function prepareWorkflow(action: WorkflowAction, viewer: WorkspaceViewer, context: AgentPlanningContext | undefined, prepare: Prepare) {
  validateWorkflowGraph(action.steps);
  const { policy } = await getAiSettings();
  const preparedSteps: PreparedWorkflow["preparedSteps"] = [];
  for (const step of action.steps) {
    const candidate = actionFor(step, {}, true);
    assertDocumentIntent([candidate], context);
    aiActionApproval(policy, candidate, "ask");
    if (candidate.type === "crm_action") authorizeCrmOperation(viewer, candidate.operation);
    if (viewer.role === "viewer") throw new Error("Connected workflows require a workspace writer role.");
    if (!step.bindings.length && !step.dependsOn.length) {
      const proposal = await prepare(candidate);
      preparedSteps.push({ step: step.id, action: proposal.action, approvalMode: proposal.approvalMode });
    }
  }
  return preparedWorkflowSchema.parse({ ...action, preparedSteps, messages: context?.messages ?? [] });
}

export async function executeWorkflow(id: string, action: PreparedWorkflow, viewer: WorkspaceViewer, request: Request, prepare: Prepare): Promise<WorkflowOutcome> {
  validateWorkflowGraph(action.steps);
  const db = createSupabaseAdmin();
  async function load(childId: string): Promise<WorkflowChild | null> {
    const { data, error } = await db.from("workspace_agent_actions").select("*").eq("id", childId).eq("user_id", viewer.id).maybeSingle();
    if (error) throw new Error("Unable to read the saved workflow step.");
    if (!data) return null;
    const child = preparedAgentActionSchema.parse(data.action);
    if (child.type === "run_workflow") throw new Error("Nested workflows are not supported.");
    const status = data.status === "pending" && new Date(data.expires_at).getTime() <= Date.now() ? "expired" : data.status;
    return { proposal: { id: childId, action: child, approvalMode: data.approval_mode, expiresAt: data.expires_at }, status, result: data.result ?? {} };
  }
  return runStoredWorkflow({ id, action, deadline: Date.now() + 160_000, load,
    prepare: async (step, results) => { const proposal = await prepare(actionFor(step, results)); return { action: proposal.action, approvalMode: proposal.approvalMode }; },
    store: async (proposal, refreshExpired) => {
      const values = { action: proposal.action, approval_mode: proposal.approvalMode, expires_at: proposal.expiresAt };
      const { error } = refreshExpired
        ? await db.from("workspace_agent_actions").update({ ...values, result: null }).eq("id", proposal.id).eq("user_id", viewer.id).eq("status", "pending").lte("expires_at", new Date().toISOString())
        : await db.from("workspace_agent_actions").insert({ ...values, id: proposal.id, user_id: viewer.id });
      if (error && error.code !== "23505") throw new Error("Unable to save the next workflow step.");
      const child = await load(proposal.id);
      if (!child) throw new Error("Unable to confirm the saved workflow step.");
      return child;
    },
    apply: async (proposal, approval) => {
      const { POST } = await import("@/app/api/ai/assistant/action/route");
      const response = await POST(new Request(new URL("/api/ai/assistant/action", request.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id, decision: "approve", approval }) }));
      return response.json();
    },
    checkpoint: async result => {
      const { error } = await db.from("workspace_agent_actions").update({ result }).eq("id", id).eq("user_id", viewer.id).eq("status", "running");
      if (error) throw new Error("Unable to save workflow progress. Check the stored result before continuing.");
    },
  });
}
