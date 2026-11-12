import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function request(fetch: typeof globalThis.fetch) {
  const exports = {} as { requestFollowup: (url: string, init?: RequestInit, timeoutMs?: number) => Promise<unknown> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/email-followup-request.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, fetch, AbortSignal });
  return exports.requestFollowup;
}
test("non-JSON failures and expired sessions produce useful errors without rendering HTML", async () => {
  await assert.rejects(request(async () => new Response("<html>proxy failed</html>", { status: 502 }))("/api/email/follow-up"), /temporarily unavailable \(502\)/);
  await assert.rejects(request(async () => new Response("", { status: 401 }))("/api/email/follow-up"), /session has expired/);
  await assert.rejects(request(async () => Response.json({ error: "This mailbox is unavailable." }, { status: 409 }))("/api/email/follow-up"), /mailbox is unavailable/);
});
test("network and timeout failures never replay a scheduling request", async () => {
  let calls = 0;
  const run = request(async () => { calls++; throw new TypeError("Failed to fetch"); });
  await assert.rejects(run("/api/email/follow-up", { method: "POST", body: "save" }), /Check your connection/);
  assert.equal(calls, 1);
  const timeout = request(async (_url, init) => { const signal = init!.signal!; await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))); throw new Error("unreachable"); });
  // Keep the test alive: AbortSignal.timeout intentionally uses an unref timer.
  const keepAlive = setTimeout(() => {}, 100);
  try { await assert.rejects(timeout("/api/email/follow-up", undefined, 5), /request timed out/); }
  finally { clearTimeout(keepAlive); }
});
