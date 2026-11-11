import assert from "node:assert/strict";
import test from "node:test";
import { sessionFetch } from "../lib/supabase/session-fetch.ts";

const url = "https://test.supabase.co/rest/v1/rpc/read_workspace_session";
const options = { method: "POST", body: "{}" };

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
    if (milliseconds !== 15000) attempt = controller;
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
