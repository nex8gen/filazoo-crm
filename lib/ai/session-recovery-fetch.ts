import { isWorkspaceSessionRetry } from "../workspace-session-response.ts";

export class AssistantSessionError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 401 ? "Your session has expired. Sign in again, then retry your saved prompt." : "Your workspace connection is temporarily unavailable. Your prompt is still here; please try again.");
    this.name = "AssistantSessionError";
    this.status = status;
  }
}

function waitForRecovery(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, milliseconds);
    signal.addEventListener("abort", stop, { once: true });
  });
}

/** Never retry an unknown POST outcome. Only a server-confirmed pre-execution
 * session failure is safe to replay with the exact same history/request IDs. */
export async function fetchWithSessionRecovery(url: string, init: RequestInit, options: {
  fetcher?: typeof fetch; onRetry?: (attempt: number) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
} = {}) {
  const fetcher = options.fetcher ?? fetch;
  const deadline = AbortSignal.timeout(165_000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const request = { ...init, signal };
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await fetcher(url, request);
    if (attempt >= 2 || response.status !== 503 || !response.headers.get("content-type")?.includes("application/json")) return response;
    const body = await response.clone().json().catch(() => null);
    if (!isWorkspaceSessionRetry(response, body)) return response;
    await response.body?.cancel().catch(() => {});
    options.onRetry?.(attempt + 1);
    await (options.wait ?? waitForRecovery)((attempt + 1) * 1000, signal);
  }
}
