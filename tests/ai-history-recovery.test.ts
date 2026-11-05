import test from "node:test";
import assert from "node:assert/strict";
import { requestHistoryJson } from "../lib/ai/history-http.ts";
import { sessionFetch } from "../lib/supabase/session-fetch.ts";
import { withWorkspaceViewer, currentWorkspaceContext } from "../lib/workspace-context.ts";

test("history GET recovers once from transient status, HTML server errors or dropped connections", async () => {
  for (const first of [() => Response.json({ error: "Temporary session failure" }, { status: 503 }), () => new Response("<html>Server error</html>", { status: 500 }), () => { throw new TypeError("fetch failed"); }]) {
    let calls = 0;
    const result = await requestHistoryJson("/api/ai/history?resume=true", undefined, async () => ++calls === 1 ? first() : Response.json({ conversations: [] }));
    assert.deepEqual(result.conversations, []);
    assert.equal(calls, 2);
  }
});

test("history mutations, authentication failures and cancellation never auto-replay", async () => {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    let calls = 0;
    await assert.rejects(requestHistoryJson("/api/ai/history", { method }, async () => { calls++; throw new TypeError("Connection lost after commit"); }), /temporarily unavailable/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(requestHistoryJson("/api/ai/history", undefined, async () => { calls++; return new Response("<html>Sign in</html>", { status: 401 }); }), /session has expired/);
  assert.equal(calls, 1);
  const controller = new AbortController();
  await assert.rejects(requestHistoryJson("/api/ai/history", { signal: controller.signal }, async () => { controller.abort(); throw controller.signal.reason; }), { name: "AbortError" });
});

test("persistent history outage stops after two reads with a recoverable message", async () => {
  let calls = 0;
  await assert.rejects(requestHistoryJson("/api/ai/history", undefined, async () => { calls++; return new Response("Bad gateway", { status: 502 }); }), /Retry loading/);
  assert.equal(calls, 2);
});

test("read-only POST session RPC retries preserve credentials, body, scope and request deadline", async () => {
  for (const rpc of ["read_workspace_session", "read_crm_session"]) {
    let calls = 0;
    const body = JSON.stringify({ p_user_id: "synthetic", p_session_id: "synthetic" });
    const fetcher = sessionFetch(async (_url, init) => {
      calls++;
      assert.equal(init?.method, "POST"); assert.equal(init?.body, body);
      assert.equal(new Headers(init?.headers).get("x-crm-control"), "1");
      assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
      if (calls === 1) throw new TypeError("fetch failed");
      return Response.json([]);
    });
    assert.equal((await fetcher(`https://test.supabase.co/rest/v1/rpc/${rpc}`, { method: "POST", body, headers: { "x-crm-control": "1" } })).status, 200);
    assert.equal(calls, 2);
  }
});

test("session transport never retries writes, permission failures, cancelled requests or arbitrary errors", async () => {
  for (const rpc of ["create_workspace", "finish_ai_chat_turn", "mutate_invoice"]) {
    let calls = 0;
    const transport = sessionFetch(async () => { calls++; throw new TypeError("fetch failed"); });
    await assert.rejects(transport(`https://test.supabase.co/rest/v1/rpc/${rpc}`, { method: "POST", body: "{}" }));
    assert.equal(calls, 1);
  }
  for (const status of [401, 403, 404, 429]) {
    let calls = 0;
    const transport = sessionFetch(async () => { calls++; return new Response(null, { status }); });
    assert.equal((await transport("https://test.supabase.co/rest/v1/rpc/read_workspace_session", { method: "POST", body: "{}" })).status, status);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const controller = new AbortController();
  const transport = sessionFetch(async () => { calls++; controller.abort(); throw controller.signal.reason; });
  await assert.rejects(transport("https://test.supabase.co/rest/v1/rpc/read_workspace_session", { method: "POST", body: "{}", signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("verified viewer scope stays inside its request and supports the existing legacy workspace", async () => {
  const a = { id: "actor-a", workspaceId: "aaaaaaaa-1111-4222-8333-444444444444" };
  const b = { id: "actor-b", workspaceId: "bbbbbbbb-1111-4222-8333-444444444444" };
  const results = await Promise.all([a, b].map(viewer => withWorkspaceViewer(viewer, async () => { await Promise.resolve(); return currentWorkspaceContext(); })));
  assert.deepEqual(results, [{ workspaceId: a.workspaceId, userId: a.id }, { workspaceId: b.workspaceId, userId: b.id }]);
  withWorkspaceViewer({ id: "existing-member", workspaceId: "legacy" }, () => assert.equal(currentWorkspaceContext()?.workspaceId, "legacy"));
  assert.equal(currentWorkspaceContext(), undefined);
  assert.throws(() => withWorkspaceViewer({ id: "forged", workspaceId: "unvalidated-cookie-value" }, () => {}));
});
