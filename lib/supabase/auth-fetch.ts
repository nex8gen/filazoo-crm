import { createHash } from "node:crypto";
import { fetchRead } from "./read-fetch.ts";

type RefreshResult = { body: string; status: number; statusText: string; headers: Headers };
// Coalesce refreshes from parallel server requests for the same credential.
// Hashes never leave this process; responses are held only while in flight.
const refreshing = new Map<string, Promise<RefreshResult>>();

export function authFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!url.pathname.startsWith("/auth/v1/")) return fetcher(input, init);
    if (method === "GET") return fetchRead(input, init, fetcher);
    if (method !== "POST" || url.pathname !== "/auth/v1/token" || url.searchParams.get("grant_type") !== "refresh_token"
      || typeof init?.body !== "string" || init.signal || input instanceof Request) return fetcher(input, init);

    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const key = createHash("sha256").update(JSON.stringify([url.href, [...headers.entries()].sort(), init.body])).digest("hex");
    let pending = refreshing.get(key);
    if (!pending) {
      pending = (async (): Promise<RefreshResult> => {
        const response = await fetcher(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const body = await response.text();
        let status = response.status;
        // Supabase returns 409 for concurrent refreshes. Auth JS treats 409 as
        // a permanent rejection and may remove expired session cookies. Map
        // only this documented conflict to a retryable infrastructure failure;
        // revoked/invalid refresh tokens retain their original rejection.
        if (status === 409) {
          try { if (JSON.parse(body)?.code === "conflict") status = 503; } catch { /* Keep unknown errors unchanged. */ }
        }
        const resultHeaders = new Headers(response.headers);
        resultHeaders.set("Cache-Control", "private, no-store");
        return { body, status, statusText: status === response.status ? response.statusText : "Service Unavailable", headers: resultHeaders };
      })();
      refreshing.set(key, pending);
      const active = pending;
      // Both outcomes evict the credential; failures cannot poison later tries.
      void pending.then(() => { if (refreshing.get(key) === active) refreshing.delete(key); }, () => { if (refreshing.get(key) === active) refreshing.delete(key); });
    }
    const result = await pending;
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers: result.headers });
  };
}
