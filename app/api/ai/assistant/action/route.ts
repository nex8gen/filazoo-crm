import { getAiSettings } from "@/lib/data/ai-settings";
import { aiActionApproval, AiPolicyError } from "@/lib/ai-policy";
import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { agentApprovalAllowed, preparedAgentActionSchema, type PreparedAgentAction } from "@/lib/ai/agent-actions";
import { executeAgentAction } from "@/lib/ai/agent-execution";

// Shipping approval uses the existing email API's after() worker budget.
export const maxDuration = 240;
const headers = { "Cache-Control": "private, no-store" };
const decisionSchema = z.object({ id: z.uuid(), decision: z.enum(["approve", "decline", "resume"]), approval: z.enum(["manual", "auto"]) }).strict();
function resumableOrderStage(action: PreparedAgentAction, progress: { stage?: unknown } | null | undefined, reason: unknown) {
  if (action.type === "run_workflow") return reason instanceof Error && !["AiPolicyError", "AgentReviewRequiredError"].includes(reason.name) && ["workflow_running", "workflow_waiting", "workflow_ready"].includes(String(progress?.stage));
  return action.type === "create_invoice" && Boolean(action.order) && reason instanceof Error && !["AgentReviewRequiredError", "AiPolicyError"].includes(reason.name) && ["order_starting", "order_saved", "invoice_ready"].includes(String(progress?.stage));
}

export async function GET(request: Request) {
  let viewer;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "Invalid proposal ID." }, { status: 400, headers });
  const { data, error } = await createSupabaseAdmin().from("workspace_agent_actions").select("status,result,approval,finished_at,expires_at").eq("id", id.data).eq("user_id", viewer.id).maybeSingle();
  if (error) return Response.json({ error: "Unable to read action progress." }, { status: 503, headers });
  if (!data) return Response.json({ error: "Proposal not found." }, { status: 404, headers });
  const status = data.status === "pending" && !data.result?.workflow && new Date(data.expires_at).getTime() <= Date.now() ? "expired" : data.status;
  // Return only the result fields consumed by the chat, never internal records.
  const { success, error: actionError, href, draft, draftMessage, flowId, canResume, workflow, awaitingAction, awaitingResult } = data.result ?? {};
  return Response.json({ success, error: actionError, href, draft, draftMessage, flowId, canResume, workflow, awaitingAction, awaitingResult, status, approval: data.approval, finishedAt: data.finished_at, progress: data.result?.progress ?? null, ...(status === "declined" ? { success: workflow ? success || "Remaining workflow steps were stopped. Saved results are kept." : "Action declined. Nothing was changed." } : {}), ...(status === "expired" ? { error: "This proposal expired. Ask the agent to prepare it again." } : {}) }, { headers });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  let viewer;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Approve or decline a saved agent proposal." }, { status: 400, headers });
  const { id, decision, approval } = parsed.data;
  const db = createSupabaseAdmin();
  const { data: row, error } = await db.from("workspace_agent_actions").select("*").eq("id", id).eq("user_id", viewer.id).maybeSingle();
  if (error) return Response.json({ error: "Unable to read the saved proposal." }, { status: 503, headers });
  if (!row) return Response.json({ error: "Proposal not found." }, { status: 404, headers });
  if (row.status === "completed") return Response.json({ ...row.result, status: "completed" }, { headers });
  const resumingWorkflow = decision === "resume" && approval === "manual" && row.action?.type === "run_workflow" && ["pending", "failed"].includes(row.status) && row.result?.canResume === true && ["workflow_running", "workflow_waiting", "workflow_ready"].includes(row.result?.stage);
  const resuming = resumingWorkflow || (decision === "resume" && approval === "manual" && row.status === "failed" && row.result?.canResume === true && ["order_starting", "order_saved", "invoice_ready"].includes(row.result?.stage));
  if ((decision === "resume" && !resuming) || (row.status !== "pending" && !resuming)) return Response.json({ ...row.result, status: row.status, error: row.result?.error || "This action has already been handled or is running. Check its result before starting another task." }, { status: 409, headers });
  if (!resumingWorkflow && new Date(row.expires_at).getTime() <= Date.now()) return Response.json({ error: "This proposal expired. Ask the agent to prepare it again.", status: "expired" }, { status: 409, headers });
  if (!agentApprovalAllowed(row.approval_mode, approval)) return Response.json({ error: "This proposal requires your manual approval." }, { status: 403, headers });
  const action = preparedAgentActionSchema.safeParse(row.action);
  if (!action.success) return Response.json({ error: "The saved proposal is invalid." }, { status: 400, headers });
  if (resuming && action.data.type !== "run_workflow" && (action.data.type !== "create_invoice" || !action.data.order)) return Response.json({ error: "This action does not support workflow resume." }, { status: 409, headers });
  if (viewer.role === "viewer" && (action.data.type !== "crm_action" || !["update_product", "create_catalog"].includes(action.data.operation.op))) return Response.json({ error: "Your workspace role is read-only outside your private product catalog." }, { status: 403, headers });
  if (decision !== "decline") {
    try {
      const required = aiActionApproval((await getAiSettings()).policy, action.data, "auto");
      if (approval === "auto" && required === "ask") return Response.json({ error: "Workspace AI settings require manual approval for this action." }, { status: 403, headers });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to verify AI permissions." }, { status: error instanceof AiPolicyError ? 403 : 503, headers }); }
  }
  // Compare-and-set is the execution lock across clicks, retries and server instances.
  const declinedResult = row.result?.workflow ? { ...row.result, canResume: false, awaitingAction: undefined, awaitingResult: undefined, success: "Remaining workflow steps were stopped. Saved results are kept." } : { success: "Action declined. Nothing was changed." };
  const { data: claimed, error: claimError } = await db.from("workspace_agent_actions").update({ status: decision === "decline" ? "declined" : "running", approval, ...(decision === "decline" ? { result: declinedResult } : {}) }).eq("id", id).eq("user_id", viewer.id).eq("status", row.status).select("id").maybeSingle();
  if (claimError || !claimed) return Response.json({ error: "Another request already handled this action. Check its result.", status: "running" }, { status: 409, headers });
  if (decision === "decline") return Response.json({ ...declinedResult, status: "declined" }, { headers });
  try {
    let result;
    try { result = await executeAgentAction(id, action.data, viewer, request); }
    catch (reason) {
      const checkpoint = await db.from("workspace_agent_actions").select("result").eq("id", id).eq("user_id", viewer.id).maybeSingle();
      const transient = reason instanceof Error && /network|fetch failed|temporar|timed?\s*out|timeout|interruption|unavailable|not ready|connection|could not be loaded|unable to read/i.test(reason.message);
      if (checkpoint.error || !transient || !resumableOrderStage(action.data, checkpoint.data?.result, reason)) throw reason;
      // One bounded continuation uses the same durable IDs and existing
      // approval. Sending/uncertain SMTP stages can never enter this path.
      result = await executeAgentAction(id, action.data, viewer, request);
    }
    const status = "workflowCancelled" in result && result.workflowCancelled ? "declined" : "workflowPaused" in result && result.workflowPaused ? "pending" : "completed";
    const saved = await db.from("workspace_agent_actions").update({ status, result, finished_at: status === "completed" ? new Date().toISOString() : null }).eq("id", id).eq("user_id", viewer.id);
    if (saved.error) console.error("Agent result persistence failed", saved.error.code);
    return Response.json({ ...result, status }, { headers });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "The action could not be completed. Check Invoices and Sent before starting another task.";
    const checkpoint = await db.from("workspace_agent_actions").select("result").eq("id", id).eq("user_id", viewer.id).maybeSingle();
    const progress = checkpoint.data?.result;
    const canResume = resumableOrderStage(action.data, progress, reason);
    const result = { ...progress, error: message, canResume };
    await db.from("workspace_agent_actions").update({ status: "failed", result, finished_at: new Date().toISOString() }).eq("id", id).eq("user_id", viewer.id);
    return Response.json({ ...result, status: "failed" }, { status: 400, headers });
  }
}
