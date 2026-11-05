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
    const options = { ...init, cache: "no-store" as const, signal: deadline };
    for (let attempt = 0; ; attempt++) {
      deadline.throwIfAborted();
      try {
        const response = await fetcher(input, options);
        if (attempt === 0 && [502, 503, 504, 520].includes(response.status) && !deadline.aborted) {
          await response.body?.cancel().catch(() => {});
          continue;
        }
        return response;
      } catch (error) {
        if (attempt > 0 || deadline.aborted || !(error instanceof TypeError)) throw error;
      }
    }
  };
}
