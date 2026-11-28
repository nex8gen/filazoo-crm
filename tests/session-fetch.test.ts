import assert from "node:assert/strict";
import test from "node:test";
import { sessionFetch } from "../lib/supabase/session-fetch.ts";

const url = "https://test.supabase.co/rest/v1/rpc/read_secure_workspace_session";
const options = { method: "POST", body: "{}" };

test("subscription-aware authorization is a read-only retry while settlement and checkout are never replayed", async () => {
  for (const [name, expected] of [["read_secure_workspace_session",2],["read_subscribed_workspace_session",2],["read_workspace_session",2],["read_crm_session",2],["create_subscription_order",1],["confirm_subscription_payment",1]] as const) {
    let calls = 0;
    const request = sessionFetch(async () => { calls++; throw new TypeError("fetch failed"); });
    await assert.rejects(request(`https://test.supabase.co/rest/v1/rpc/${name}`, options), /fetch failed/);
    assert.equal(calls, expected);
  }
});

test("session reads recover when the connection drops after response headers", async () => {
  let calls = 0;
  const request = sessionFetch(async () => {
    calls++;
    return calls === 1
      ? new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } }))
      : Response.json([{ id: "verified-session" }]);
  });
  assert.deepEqual(await (await request(url, options)).json(), [{ id: "verified-session" }]);
  assert.equal(calls, 2);
});

test("a stalled session attempt leaves time for a fresh connection within the total deadline", async t => {
  let attempt = new AbortController();
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    const controller = new AbortController();
    if (milliseconds !== 31000) attempt = controller;
    return controller.signal;
  });
  let calls = 0;
  const request = sessionFetch(async (_input, init) => {
    calls++;
    if (calls === 1) {
      attempt.abort(new DOMException("Attempt timed out", "TimeoutError"));
      init?.signal?.throwIfAborted();
    }
    return Response.json([]);
  });
  assert.equal((await request(url, options)).status, 200);
  assert.equal(calls, 2);
});

test("persistent session connection failures stop after one retry", async () => {
  let calls = 0;
  const request = sessionFetch(async () => { calls++; throw new TypeError("fetch failed"); });
  await assert.rejects(request(url, options), /fetch failed/);
  assert.equal(calls, 2);
});

test("an expired overall session deadline never starts another fetch", async t => {
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new DOMException("Timed out", "TimeoutError")));
  let calls = 0;
  const request = sessionFetch(async () => { calls++; return Response.json([]); });
  await assert.rejects(request(url, options), { name: "TimeoutError" });
  assert.equal(calls, 0);
});

test("a session response taking twelve seconds completes without being aborted or duplicated", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
  let calls = 0;
  const request = sessionFetch(async (_input, init) => {
    calls++;
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      setTimeout(() => resolve(Response.json([{ id: "slow-but-valid" }])), 12_000);
    });
  });
  const response = request(url, options);
  t.mock.timers.tick(12_000);
  assert.deepEqual(await (await response).json(), [{ id: "slow-but-valid" }]);
  assert.equal(calls, 1);
});

test("parallel page and API session checks share only the in-flight live snapshot", async () => {
  let reads = 0;
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { complete = resolve; });
  const fetcher: typeof fetch = async () => { reads++; return reads === 1 ? pending : Response.json([{ role: "viewer" }]); };
  const clients = Array.from({ length: 12 }, () => sessionFetch(fetcher));
  const requests = clients.map(client => client(url, options));
  assert.equal(reads, 1);
  complete(Response.json([{ role: "operator" }]));
  for (const response of await Promise.all(requests)) assert.deepEqual(await response.json(), [{ role: "operator" }]);
  assert.deepEqual(await (await clients[0](url, options)).json(), [{ role: "viewer" }]);
  assert.equal(reads, 2, "completed authorization is never cached");
});

test("in-flight session deduplication isolates user, session, workspace, project and credentials", async () => {
  let reads = 0;
  const fetcher: typeof fetch = async () => { reads++; await Promise.resolve(); return Response.json([]); };
  const base = { p_user_id: "user-a", p_session_id: "session-a", p_workspace_id: "workspace-a" };
  await Promise.all([
    ...[base, { ...base, p_user_id: "user-b" }, { ...base, p_session_id: "session-b" }, { ...base, p_workspace_id: "workspace-b" }].map(body => sessionFetch(fetcher)(url, { ...options, body: JSON.stringify(body) })),
    sessionFetch(fetcher)(url.replace("test.supabase.co", "other.supabase.co"), { ...options, body: JSON.stringify(base) }),
    sessionFetch(fetcher)(url, { ...options, body: JSON.stringify(base), headers: { Authorization: "Bearer different-project-key" } }),
  ]);
  assert.equal(reads, 6);
});

test("an exhausted shared session read is evicted and the next request can verify again", async () => {
  let reads = 0;
  const fetcher: typeof fetch = async () => {
    reads++;
    if (reads <= 2) throw new TypeError("fetch failed");
    return Response.json([{ role: "viewer" }]);
  };
  const first = sessionFetch(fetcher)(url, options);
  const second = sessionFetch(fetcher)(url, options);
  await Promise.all([assert.rejects(first, /fetch failed/), assert.rejects(second, /fetch failed/)]);
  assert.equal(reads, 2);
  assert.deepEqual(await (await sessionFetch(fetcher)(url, options)).json(), [{ role: "viewer" }]);
  assert.equal(reads, 3);
});
