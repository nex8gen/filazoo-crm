import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithSessionRecovery } from "../lib/ai/session-recovery-fetch.ts";
import { isWorkspaceSessionRetry, workspaceSessionUnavailableResponse } from "../lib/workspace-session-response.ts";
import { requestHistoryJson } from "../lib/ai/history-http.ts";
import { sessionFetch } from "../lib/supabase/session-fetch.ts";

const url = "/api/ai/assistant";
const init = { method: "POST", body: JSON.stringify({ history: { requestId: "same-request", version: 0 }, messages: [{ role: "user", content: "Plan a campaign" }] }), headers: { "Content-Type": "application/json" } };
const noWait = async () => {};

test("an explicit pre-execution session failure recovers without changing prompt, request ID or mode", async () => {
  let calls = 0;
  const progress: number[] = [];
  const result = await fetchWithSessionRecovery(url, init, { wait: noWait, onRetry: attempt => progress.push(attempt), fetcher: async (path, request) => {
    assert.equal(path, url); assert.equal(request?.body, init.body); assert.equal(request?.method, "POST");
    return ++calls < 3 ? workspaceSessionUnavailableResponse() : Response.json({ output: "What is the campaign goal?", actions: [] });
  } });
  assert.equal(calls, 3); assert.deepEqual(progress, [1, 2]);
  assert.equal((await result.json()).output, "What is the campaign goal?");
});

test("recovery stops after two retries and leaves the final response readable", async () => {
  let calls = 0;
  const result = await fetchWithSessionRecovery(url, init, { wait: noWait, fetcher: async () => { calls++; return workspaceSessionUnavailableResponse(); } });
  assert.equal(calls, 3); assert.equal(result.status, 503);
  assert.equal(isWorkspaceSessionRetry(result, await result.json()), true);
});

test("AI execution, denied sessions, provider errors and unknown POST outcomes never auto-replay", async () => {
  for (const response of [Response.json({ error: "Sign in" }, { status: 401 }), Response.json({ error: "Denied" }, { status: 403 }), Response.json({ error: "Provider unavailable" }, { status: 503 }), Response.json({ code: "WORKSPACE_SESSION_UNAVAILABLE", retryable: true, executionStarted: true }, { status: 503 }), new Response("Bad gateway", { status: 502 }), Response.json({ output: "Ready", actions: [{ id: "already-prepared" }] })]) {
    let calls = 0;
    assert.equal(await fetchWithSessionRecovery(url, init, { wait: noWait, fetcher: async () => { calls++; return response; } }), response);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(fetchWithSessionRecovery(url, init, { wait: noWait, fetcher: async () => { calls++; throw new TypeError("Connection lost after possible execution"); } }), /Connection lost/);
  assert.equal(calls, 1);
});

test("cancelling during reconnection stops before another request starts", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(fetchWithSessionRecovery(url, { ...init, signal: controller.signal }, { wait: async (_milliseconds, signal) => { controller.abort(); signal.throwIfAborted(); }, fetcher: async () => { calls++; return workspaceSessionUnavailableResponse(); } }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("history creation retries only a confirmed rejection before it created a conversation", async () => {
  let calls = 0;
  const result = await requestHistoryJson("/api/ai/history", { method: "POST", body: "same-context" }, async (_path, request) => {
    assert.equal(request?.body, "same-context");
    return ++calls === 1 ? workspaceSessionUnavailableResponse() : Response.json({ conversation: { id: "created-once" } }, { status: 201 });
  });
  assert.equal(calls, 2); assert.equal(result.conversation.id, "created-once");
  calls = 0;
  await assert.rejects(requestHistoryJson("/api/ai/history", { method: "POST" }, async () => { calls++; return Response.json({ error: "Uncertain persistence outcome" }, { status: 503 }); }), /Uncertain/);
  assert.equal(calls, 1);
});

test("read-only session transport also recovers from timeout and internal gateway HTTP statuses", async () => {
  for (const status of [408, 500, 521, 522, 524]) {
    let calls = 0;
    const fetcher = sessionFetch(async () => ++calls === 1 ? new Response(null, { status }) : Response.json([{ id: "live-verified" }]));
    const response = await fetcher("https://test.supabase.co/rest/v1/rpc/read_workspace_session", { method: "POST", body: "{}" });
    assert.equal(calls, 2); assert.equal(response.status, 200);
  }
});
