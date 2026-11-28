import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { FlowPreparationRetry } from "../flow-execution-errors.ts";

/** A reservation is held across SMTP; an uncertain submission must never be resent. */
export async function reserveWorkflowEmail(runId: string, stepId: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdmin().rpc("reserve_workflow_email", { p_run_id: runId, p_step_id: stepId });
  if (error || !data) throw new FlowPreparationRetry("Unable to check the workflow email allowance. Delivery will retry safely.", 60_000, "data");
  if (data.state === "limited") {
    const reset = Date.parse(data.resetsAt);
    throw new FlowPreparationRetry("Monthly workflow email allowance reached. Sending will resume after the monthly reset, or you can review your plan.", Number.isFinite(reset) ? Math.max(60_000, reset - Date.now()) : 3_600_000, "monthly_limit");
  }
  if (data.state === "sent") return false;
  if (data.state === "pending" || data.state === "uncertain") throw new Error("Delivery may have started for this workflow email. Check its delivery history before retrying.");
  if (data.state !== "reserved") throw new FlowPreparationRetry("Unable to confirm workflow email capacity. Delivery will retry safely.", 60_000, "data");
  return true;
}

export async function finishWorkflowEmail(runId: string, stepId: string, outcome: "sent" | "released" | "uncertain") {
  const { error } = await createSupabaseAdmin().rpc("finish_workflow_email", { p_run_id: runId, p_step_id: stepId, p_outcome: outcome });
  if (error) throw new Error("Unable to record the workflow email delivery outcome.");
}

export function workflowEmailNotSubmitted(cause: unknown) {
  const error = cause as { message?: string; code?: string; command?: string; responseCode?: number } | null;
  return /^SMTP connection failed before submission:/.test(error?.message ?? "")
    || /^AUTH(?:\s|$)/.test(error?.command ?? "") && error?.code === "EAUTH"
    || typeof error?.responseCode === "number" && error.responseCode >= 400 && error.responseCode <= 599;
}
