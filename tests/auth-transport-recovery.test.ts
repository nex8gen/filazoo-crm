import assert from "node:assert/strict";
import test from "node:test";
import { authFetch } from "../lib/supabase/auth-fetch.ts";
import { isTransientAuthError } from "../lib/supabase/auth-error.ts";
import { createClient } from "@supabase/supabase-js";

const url = "https://test.supabase.co/auth/v1/token?grant_type=refresh_token";
const init = { method: "POST", body: '{"refresh_token":"session-a"}', headers: { apikey: "project-a" } };

test("parallel server clients share one token refresh and each receives a readable response", async () => {
  let calls = 0;
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { complete = resolve; });
  const fetcher: typeof fetch = async () => { calls++; return pending; };
  const requests = Array.from({ length: 12 }, () => authFetch(fetcher)(url, init));
  assert.equal(calls, 1);
  complete(Response.json({ access_token: "renewed" }, { headers: { "X-Request-Id": "refresh-a" } }));
  for (const response of await Promise.all(requests)) {
    assert.deepEqual(await response.json(), { access_token: "renewed" });
    assert.equal(response.headers.get("X-Request-Id"), "refresh-a");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  // No completed session or successful authorization is globally cached.
  await authFetch(async () => { calls++; return Response.json({ access_token: "fresh" }); })(url, init);
  assert.equal(calls, 2);
});

test("refreshes never share credentials across users, projects or API keys", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; await Promise.resolve(); return Response.json({ access_token: "token" }); };
  await Promise.all([
    authFetch(fetcher)(url, init),
    authFetch(fetcher)(url, { ...init, body: '{"refresh_token":"session-b"}' }),
    authFetch(fetcher)(url, { ...init, headers: { apikey: "project-b" } }),
    authFetch(fetcher)(url.replace("test.supabase.co", "other.supabase.co"), init),
  ]);
  assert.equal(calls, 4);
});

test("failed refreshes are evicted so the next request can reconnect", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { if (++calls === 1) throw new TypeError("fetch failed"); return Response.json({ access_token: "recovered" }); };
  await assert.rejects(authFetch(fetcher)(url, init), /fetch failed/);
  assert.equal((await authFetch(fetcher)(url, init)).status, 200);
  assert.equal(calls, 2);
});

test("only concurrent-refresh conflicts become retryable; revoked tokens keep their rejection", async () => {
  for (const [status, code, expected] of [[409, "conflict", 503], [409, "other", 409], [400, "refresh_token_not_found", 400], [401, "bad_jwt", 401]] as const) {
    const request = authFetch(async () => Response.json({ code }, { status }));
    const response = await request(url, init);
    assert.equal(response.status, expected);
    assert.deepEqual(await response.json(), { code });
  }
  for (const error of [{ name: "AuthRetryableFetchError" }, { status: 409, code: "conflict" }, { status: 503 }, { name: "TimeoutError" }]) assert.equal(isTransientAuthError(error), true);
  for (const error of [null, { status: 401 }, { status: 400, code: "refresh_token_not_found" }, { status: 409, code: "other" }, new Error("Invalid signature")]) assert.equal(isTransientAuthError(error), false);
});

test("sign-in, sign-out and credential updates are neither coalesced nor replayed", async () => {
  for (const [path, method] of [[url.replace("refresh_token", "password"), "POST"], ["https://test.supabase.co/auth/v1/logout", "POST"], ["https://test.supabase.co/auth/v1/user", "PUT"]]) {
    let calls = 0;
    const request = authFetch(async () => { calls++; return new Response(null, { status: 503 }); });
    await Promise.all([request(path, { ...init, method }), request(path, { ...init, method })]);
    assert.equal(calls, 2);
  }
});

test("the installed Auth SDK recovers a refresh conflict and retains the renewed session", async () => {
  let calls = 0;
  const accessToken = ["header", Buffer.from(JSON.stringify({ sub: "user-a", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "signature"].join(".");
  const client = createClient("https://test.supabase.co", "project-a", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: authFetch(async () => ++calls === 1
      ? Response.json({ code: "conflict", message: "Too many concurrent token refresh requests on the same session or refresh token" }, { status: 409 })
      : Response.json({ access_token: accessToken, refresh_token: "session-renewed", token_type: "bearer", expires_in: 3600, user: { id: "user-a" } })) },
  });
  const result = await client.auth.refreshSession({ refresh_token: "session-a" });
  assert.equal(result.error, null);
  assert.equal(result.data.session?.refresh_token, "session-renewed");
  assert.equal((await client.auth.getSession()).data.session?.access_token, accessToken);
  assert.equal(calls, 2);
});
