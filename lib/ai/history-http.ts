import { isWorkspaceSessionRetry } from "../workspace-session-response.ts";
import { AssistantSessionError } from "./session-recovery-fetch.ts";

export class HistoryHttpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
/** Retry reads once, or an explicitly confirmed failure before any work began.
 * Never replay an unknown save, rename, deletion or AI execution outcome. */
export async function requestHistoryJson(url: string, init?: RequestInit, fetcher: typeof fetch = fetch) {
  const usage = url.split("?")[0] === "/api/ai/usage";
  const unavailable = usage ? "AI usage is temporarily unavailable. Retry loading it." : "Saved conversations are temporarily unavailable. Retry loading them.";
  const timedOut = usage ? "AI usage took too long to respond. Retry loading it." : "History took too long to respond. Retry loading it or start a new conversation.";
  const read = !init?.method || init.method.toUpperCase() === "GET";
  // Bound the whole operation, including its one read retry. A stalled network
  // must not leave the composer or history controls disabled indefinitely.
  const deadline = AbortSignal.timeout(15_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  for (let attempt = 0; ; attempt++) {
    init?.signal?.throwIfAborted();
    let response: Response;
    try { response = await fetcher(url, { cache: "no-store", ...init, signal }); }
    catch (error) {
      if (deadline.aborted) throw new Error(timedOut);
      if (read && attempt === 0 && error instanceof TypeError && !init?.signal?.aborted) continue;
      if (init?.signal?.aborted) throw error;
      throw new Error(unavailable);
    }
    const result = await response.json().catch(() => null);
    if (deadline.aborted) throw new Error(timedOut);
    if (response.ok && result) return result;
    if (attempt === 0 && !init?.signal?.aborted && ((read && [500, 502, 503, 504].includes(response.status)) || isWorkspaceSessionRetry(response, result))) continue;
    if (isWorkspaceSessionRetry(response, result)) throw new AssistantSessionError(503);
    if (response.status === 401) throw new HistoryHttpError("Your session has expired. Sign in again to continue.", 401);
    throw new HistoryHttpError(result?.error || unavailable, response.status);
  }
}
