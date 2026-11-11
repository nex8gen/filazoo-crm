import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { flowRecoveryState } from "../flow-recovery.ts";

export async function recoverFlowRun(flowId: string, runId: string, action: "retry" | "cancel") {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const db = createSupabaseAdmin();
  const { data: flow } = await db.from("flows").select("user_id,status,trigger_config").eq("id", flowId).maybeSingle().throwOnError();
  if (!flow || viewer.role !== "admin" && viewer.id !== flow.user_id) throw new Error("Only the workflow owner or an administrator can recover its runs.");
  const { data: run } = await db.from("flow_runs").select("id,status,current_step,context,locked_at,flow_run_logs(step_id,result,error,created_at)").eq("flow_id", flowId).eq("id", runId).maybeSingle().throwOnError();
  if (!run) throw new Error("Workflow run not found.");
  if (run.locked_at) throw new Error("This run is being processed. Wait for it to release its action before changing it.");
  if (!["active", "failed"].includes(run.status)) throw new Error("Only waiting or failed runs can be recovered.");
  const recovery = flowRecoveryState(run);
  if (action === "retry" && flow.status !== "live") throw new Error("Turn on the workflow before retrying this action.");
  if (action === "retry" && !recovery.retryable) throw new Error("Delivery may already have started. Review the sender's Sent folder; automatic retry is disabled to prevent a duplicate.");
  const context = { ...(run.context ?? {}) };
  delete context.preparationRetry;
  delete context.executionState;
  const now = new Date().toISOString();
  const { data: changed } = await db.from("flow_runs").update({ status: action === "retry" ? "active" : "cancelled", context,
    next_run_at: action === "retry" ? now : null, finished_at: action === "retry" ? null : now, locked_at: null })
    .eq("id", runId).eq("status", run.status).eq("current_step", run.current_step).is("locked_at", null).select("id").maybeSingle().throwOnError();
  if (!changed) throw new Error("This run changed while you were reviewing it. Refresh its history.");
  const checkpoint = context.executionCheckpoint as { stepId?: string } | undefined;
  if (action === "cancel" && !recovery.uncertain && checkpoint?.stepId) await db.from("flow_run_logs").delete().eq("run_id", runId)
    .eq("result->>action", "response_claimed").eq("result->>stepId", checkpoint.stepId).throwOnError();
  await db.from("flow_run_logs").insert({ run_id: runId, result: { action: action === "retry" ? "recovery_queued" : "cancelled", actorId: viewer.id,
    reason: action === "retry" ? "Retry requested for this saved action. Current eligibility will be checked before sending." : "Stopped by a workspace member." } }).throwOnError();
  return { status: action === "retry" ? "queued" : "cancelled" };
}
