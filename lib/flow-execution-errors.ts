/** Preserve PostgREST messages too: database failures are often plain objects. */
export function workflowErrorMessage(cause: unknown) {
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") return cause.message;
  return "Workflow execution failed.";
}

// Only wrap preparation that has no external side effects. Never apply this
// classifier to SMTP submission, completed actions, or delivery persistence.
export class FlowPreparationRetry extends Error {
  readonly delayMs: number;
  readonly category: "provider" | "configuration" | "daily_limit" | "data";
  constructor(message: string, delayMs: number, category: "provider" | "configuration" | "daily_limit" | "data") {
    super(message);
    this.name = "FlowPreparationRetry";
    this.delayMs = delayMs;
    this.category = category;
  }
}

export function flowPreparationError(cause: unknown): unknown {
  const message = workflowErrorMessage(cause);
  if (/AI Gateway.*(?:authentication|credentials|expired|credits|spending budget|access is blocked)|AI auto-reply is not configured/i.test(message)) return new FlowPreparationRetry(message, 3_600_000, "configuration");
  if (/quota|rate.?limit|AI Gateway is busy|AI Gateway could not respond|incomplete response|empty response|fetch failed|timed?\s*out|timeout|ECONNRESET|ETIMEDOUT/i.test(message)
    || (cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name))) return new FlowPreparationRetry(message, 60_000, "provider");
  return cause;
}
