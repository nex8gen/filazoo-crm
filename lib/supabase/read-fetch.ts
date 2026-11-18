import { setTimeout as delay } from "node:timers/promises";

const transientStatuses = new Set([408, 500, 502, 503, 504, 520, 521, 522, 524]);

/** Only call for known read-only requests. Own the retry budget, including the
 * response body: native fetch resolves before that body has finished loading.
 */
export async function fetchRead(input: Parameters<typeof fetch>[0], init: RequestInit | undefined, fetcher: typeof fetch,
  { timeout = 31_000, attemptTimeout = 15_000 } = {}): Promise<Response> {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const deadline = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(timeout)]);
  for (let attempt = 0; ; attempt++) {
    deadline.throwIfAborted();
    const attemptDeadline = AbortSignal.timeout(attemptTimeout);
    const signal = AbortSignal.any([deadline, attemptDeadline]);
    try {
      const response = await fetcher(input, { ...init, cache: "no-store", signal });
      if (attempt === 0 && transientStatuses.has(response.status) && !deadline.aborted) {
        await response.body?.cancel().catch(() => {});
      } else {
        const body = response.body ? await response.arrayBuffer() : null;
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
    } catch (error) {
      if (attempt > 0 || deadline.aborted || (!(error instanceof TypeError) && !attemptDeadline.aborted)) throw error;
    }
    await delay(250, undefined, { signal: deadline });
  }
}
