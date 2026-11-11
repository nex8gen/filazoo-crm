type Event = { result: Record<string, unknown> | null; error: string | null; created_at: string; step_id?: string | null };
type RecoveryRun = { status: string; context?: Record<string, unknown> | null; flow_run_logs: Event[] };

export function flowRecoveryState(run: RecoveryRun) {
  const checkpoint = run.context?.executionCheckpoint as { phase?: string; stepId?: string } | undefined;
  const events = [...(run.flow_run_logs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const uncertain = checkpoint?.phase === "submitting" || checkpoint?.phase === "accepted"
    || events.some(event => /Delivery may have started|Execution was interrupted/.test(event.error || ""));
  const currentSent = checkpoint?.stepId && events.some(event => (event.step_id || event.result?.stepId) === checkpoint.stepId && event.result?.action === "email_sent");
  const legacyPreflight = events.find(event => event.error)?.error === "Address is not verified";
  const retryable = !uncertain && !currentSent && (run.status === "failed" && (checkpoint?.phase === "preparing" || legacyPreflight)
    || run.status === "active" && Boolean(run.context?.preparationRetry));
  return { retryable, uncertain };
}
