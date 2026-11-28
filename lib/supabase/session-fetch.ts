import { fetchRead } from "./read-fetch.ts";
import { createHash } from "node:crypto";

// Share only requests that are still running, never completed authorization.
// A new request after completion always rechecks revocation and membership.
const pendingReads = new WeakMap<typeof fetch, Map<string, Promise<Response>>>();

async function readSession(input: Parameters<typeof fetch>[0], init: RequestInit, fetcher: typeof fetch) {
  if (input instanceof Request || init.signal) return fetchRead(input, init, fetcher);
  let pending = pendingReads.get(fetcher);
  if (!pending) { pending = new Map(); pendingReads.set(fetcher, pending); }
  const key = createHash("sha256").update(JSON.stringify([String(input), [...new Headers(init.headers).entries()].sort(), init.body])).digest("hex");
  let response = pending.get(key);
  if (!response) {
    // Do not abort a valid but slow database response after seven seconds.
    // Live measurements exceeded twelve seconds before returning successfully.
    response = fetchRead(input, init, fetcher);
    pending.set(key, response);
    const active = response;
    const clear = () => { if (pending.get(key) === active) pending.delete(key); };
    void response.then(clear, clear);
  }
  return (await response).clone();
}

/** Session readers use POST, so the SDK's idempotent-method retries do not apply.
 * Retry only these read-only RPCs once; never replay provisioning or CRM writes.
 */
export function sessionFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const read = method === "POST" && typeof init?.body === "string"
      && ["/rest/v1/rpc/read_secure_workspace_session", "/rest/v1/rpc/read_subscribed_workspace_session", "/rest/v1/rpc/read_workspace_session", "/rest/v1/rpc/read_crm_session"].includes(url.pathname);
    if (read) return readSession(input, init!, fetcher);
    if (url.pathname.startsWith("/rest/v1/") && ["GET", "HEAD"].includes(method)) return fetchRead(input, init, fetcher);
    return fetcher(input, init);
  };
}
