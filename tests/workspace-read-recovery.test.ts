import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFetch } from "../lib/supabase/workspace-fetch.ts";

const url = "https://test.supabase.co/rest/v1/flows?select=id";
const scope = async () => ({ workspaceId: "workspace-a", userId: "user-a" });

test("workspace reads recover from gateway errors without changing tenant scope", async () => {
  for (const status of [408, 500, 502, 503, 504, 521, 522, 524]) {
    let calls = 0;
    const request = workspaceFetch(scope, async (input, init) => {
      assert.equal(String(input), url);
      assert.equal(new Headers(init?.headers).get("x-crm-workspace-id"), "workspace-a");
      assert.equal(new Headers(init?.headers).get("x-crm-user-id"), "user-a");
      return ++calls === 1 ? new Response(null, { status }) : Response.json([{ id: "saved-flow" }]);
    });
    assert.deepEqual(await (await request(url)).json(), [{ id: "saved-flow" }]);
    assert.equal(calls, 2);
  }
});

test("a connection lost after headers retries the complete workspace read", async () => {
  let calls = 0;
  const request = workspaceFetch(scope, async () => ++calls === 1
    ? new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } }))
    : Response.json([{ id: "complete-flow" }], { headers: { "Content-Range": "0-0/1" } }));
  const response = await request(url);
  assert.deepEqual(await response.json(), [{ id: "complete-flow" }]);
  assert.equal(response.headers.get("Content-Range"), "0-0/1");
  assert.equal(calls, 2);
});

test("persistent outages are bounded and never become an empty successful workspace", async () => {
  let calls = 0;
  const request = workspaceFetch(scope, async () => { calls++; return Response.json({ code: "PGRST002" }, { status: 503 }); });
  const response = await request(url);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "PGRST002" });
  assert.equal(calls, 2);
});

test("permissions, missing relations and invalid requests fail without retrying", async () => {
  for (const status of [400, 401, 403, 404, 409, 429]) {
    let calls = 0;
    const request = workspaceFetch(scope, async () => { calls++; return Response.json({ error: "rejected" }, { status }); });
    assert.equal((await request(url)).status, status);
    assert.equal(calls, 1);
  }
});

test("CRM writes and arbitrary POST RPCs are never replayed on uncertain failures", async () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    for (const failure of ["headers", "body", "network"]) {
      let calls = 0;
      const request = workspaceFetch(scope, async () => {
        calls++;
        if (failure === "network") throw new TypeError("fetch failed");
        return failure === "body"
          ? new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } }))
          : new Response(null, { status: 503 });
      });
      const result = request(url, { method, body: method === "DELETE" ? undefined : "{}" });
      if (failure === "network") await assert.rejects(result, /fetch failed/);
      else if (failure === "body") await assert.rejects((await result).text(), /terminated/);
      else assert.equal((await result).status, 503);
      assert.equal(calls, 1);
    }
  }
});

test("cancelled Request inputs stop without starting or replaying database reads", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const request = workspaceFetch(scope, async () => { calls++; return Response.json([]); });
  await assert.rejects(request(new Request(url, { signal: controller.signal })), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("slow database attempts reconnect within the budget and caller cancellation stops retries", async t => {
  let attempt = new AbortController();
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    const controller = new AbortController();
    if (milliseconds !== 31_000) attempt = controller;
    return controller.signal;
  });
  let calls = 0;
  const request = workspaceFetch(scope, async (_input, init) => {
    if (++calls === 1) {
      attempt.abort(new DOMException("Slow connection", "TimeoutError"));
      init?.signal?.throwIfAborted();
    }
    return Response.json([{ id: "recovered" }]);
  });
  assert.equal((await request(url)).status, 200);
  assert.equal(calls, 2);
  const caller = new AbortController();
  calls = 0;
  const cancelled = workspaceFetch(scope, async () => { calls++; caller.abort(); throw new TypeError("fetch failed"); });
  await assert.rejects(cancelled(url, { signal: caller.signal }));
  assert.equal(calls, 1);
});
