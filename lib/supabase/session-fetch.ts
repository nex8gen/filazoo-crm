import { setTimeout as delay } from "node:timers/promises";

/** Session readers use POST, so the SDK's idempotent-method retries do not apply.
 * Retry these two read-only RPCs once; never replay provisioning or CRM writes.
 */
export function sessionFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const read = init?.method?.toUpperCase() === "POST" && typeof init.body === "string"
      && ["/rest/v1/rpc/read_workspace_session", "/rest/v1/rpc/read_crm_session"].includes(url.pathname);
    if (!read) return fetcher(input, init);
    const deadline = AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15_000)]);
    for (let attempt = 0; ; attempt++) {
      deadline.throwIfAborted();
      // A single slow connection must not consume the entire retry budget.
      const attemptTimeout = AbortSignal.timeout(7_000);
      const signal = AbortSignal.any([deadline, attemptTimeout]);
      const options = { ...init, cache: "no-store" as const, signal };
      try {
        const response = await fetcher(input, options);
        if (attempt === 0 && [408, 500, 502, 503, 504, 520, 521, 522, 524].includes(response.status) && !deadline.aborted) {
          await response.body?.cancel().catch(() => {});
        } else {
          // fetch resolves at the headers. Read the small session response here
          // so a dropped/stalled body is covered by the same retry and deadline.
          const body = response.body ? await response.arrayBuffer() : null;
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        }
      } catch (error) {
        if (attempt > 0 || deadline.aborted || (!(error instanceof TypeError) && !attemptTimeout.aborted)) throw error;
      }
      // Let a temporarily broken upstream connection recover before reconnecting.
      await delay(250, undefined, { signal: deadline });
    }
  };
}
