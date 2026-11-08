import type { AgentActionResult } from "./agent-actions.ts";

/** Recover a lost execution response using reads only; never replay a write. */
export async function recoverAgentAction(id: string, options: { fetcher?: typeof fetch; attempts?: number; pause?: () => Promise<void> } = {}): Promise<AgentActionResult> {
  const fetcher = options.fetcher ?? fetch;
  const attempts = options.attempts ?? 5;
  let latest: AgentActionResult = { status: "unknown", error: "Checking the saved action result did not finish. Check its status before starting it again." };
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(`/api/ai/assistant/action?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(4_000) });
      const result = await response.json();
      if (response.ok && typeof result?.status === "string") {
        latest = { ...result, ...(result.status === "running" ? { error: undefined } : {}) };
        if (["completed", "failed", "declined", "pending", "expired"].includes(result.status)) return latest;
      } else if (response.status === 401 || response.status === 403 || response.status === 404) {
        return { status: "unknown", error: result?.error || "Sign in to check the saved action result." };
      }
    } catch { /* A transient read failure does not establish an execution failure. */ }
    if (attempt + 1 < attempts) await (options.pause ?? (() => new Promise(resolve => setTimeout(resolve, 1_000))))();
  }
  return latest;
}
