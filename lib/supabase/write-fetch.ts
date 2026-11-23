/** Retry only table transactions PostgreSQL explicitly says it rolled back.
 * A timeout, dropped connection, or generic 500 can have committed: never replay it.
 * RPCs are excluded because their external side effects are not known here.
 */
export async function fetchTableWrite(input: Parameters<typeof fetch>[0], init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const replayable = /^\/rest\/v1\/[^/]+$/.test(url.pathname) && !(init.body instanceof ReadableStream);
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const response = await fetcher(input instanceof Request ? input.clone() : input, init);
    if (!replayable || response.ok || attempt >= 2) return response;
    const error: unknown = await response.clone().json().catch(() => null);
    if (!error || typeof error !== "object" || !("code" in error) || !["40P01", "40001"].includes(String(error.code))) return response;
    await response.body?.cancel().catch(() => {});
    // Desynchronize competing transactions without holding another database lock.
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, 40 * 2 ** attempt + Math.floor(Math.random() * 40));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
}
