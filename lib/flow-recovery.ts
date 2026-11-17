type Event = { result: Record<string, unknown> | null; error: string | null; created_at: string; step_id?: string | null };
type RecoveryRun = { status: string; context?: Record<string, unknown> | null; flow_run_logs: Event[] };

/** Resolve the action from the run's own snapshot, never from today's root indices. */
export function flowRunActionId(run: { context?: Record<string, unknown> | null; current_step: number }): string | null {
  for (const key of ["preparationRetry", "executionCheckpoint"]) {
    const value = run.context?.[key];
    if (value && typeof value === "object" && "stepId" in value && typeof value.stepId === "string") return value.stepId;
  }
  try {
    const definition = run.context?.definition;
    const steps = typeof definition === "string" ? JSON.parse(definition) : definition;
    return Array.isArray(steps) && typeof steps[run.current_step]?.id === "string" ? steps[run.current_step].id : null;
  } catch { return null; }
}

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
