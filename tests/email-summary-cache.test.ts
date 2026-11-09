import assert from "node:assert/strict";
import test from "node:test";
import { emailSummaryCacheKey, EmailSummaryPendingError, reuseEmailSummary, type EmailSummaryStore } from "../lib/ai/email-summary-cache.ts";
import { requestEmailSummary } from "../lib/email-summary-client.ts";

const output = JSON.stringify({ title: "PLA inquiry", summary: "Buyer requests PLA.", nextStep: "Confirm quantity.", followUpAt: null, followUpReason: "No deadline agreed." });
function memoryStore() {
  let saved: { output: string; generatedAt: string } | null = null;
  let lease: string | null = null;
  const store: EmailSummaryStore = {
    read: async () => saved,
    claim: async token => { if (lease) return false; lease = token; return true; },
    complete: async (token, output, generatedAt) => { assert.equal(token, lease); saved = { output, generatedAt }; },
    release: async token => { if (lease === token) lease = null; },
  };
  return store;
}

test("saved summaries survive reader remounts and follow-up writes without another AI call", async () => {
  const store = memoryStore();
  let calls = 0;
  const generate = async () => { calls++; return output; };
  assert.equal((await reuseEmailSummary(store, "first", generate)).cached, false);
  assert.equal((await reuseEmailSummary(store, "reopened", generate)).cached, true);
  assert.equal((await reuseEmailSummary(store, "reloaded", generate)).output, output);
  assert.equal(calls, 1);
  const first = { mode: "summary", text: "Buyer requests PLA", language: "en", currentFollowUpAt: null };
  assert.equal(emailSummaryCacheKey(first, {}, "admin"), emailSummaryCacheKey({ ...first, currentFollowUpAt: "2026-11-10T01:00:00Z", refreshSummary: true }, {}, "admin"));
  assert.equal(emailSummaryCacheKey(first, {}, "admin"), emailSummaryCacheKey({ ...first, messageDirection: "inbound" }, {}, "admin"), "Existing briefs are repaired without paying for generation again");
  assert.equal(emailSummaryCacheKey(first, { a: true, b: false }, "admin"), emailSummaryCacheKey({ language: "en", text: first.text, mode: "summary" }, { b: false, a: true }, "admin"));
});

test("message, history, customer, language, policy, role and model changes invalidate the saved brief", () => {
  const first = { text: "PLA", language: "en", customerProfile: { companyName: "Buyer" }, conversationHistory: [] };
  const key = emailSummaryCacheKey(first, { allowed: true }, "admin", "configured-model");
  for (const change of [{ text: "PETG" }, { language: "zh-CN" }, { customerProfile: { companyName: "New buyer" } }, { conversationHistory: [{ body: "New reply" }] }]) {
    assert.notEqual(emailSummaryCacheKey({ ...first, ...change }, { allowed: true }, "admin", "configured-model"), key);
  }
  assert.notEqual(emailSummaryCacheKey(first, { allowed: false }, "admin", "configured-model"), key);
  assert.notEqual(emailSummaryCacheKey(first, { allowed: true }, "viewer", "configured-model"), key);
  assert.notEqual(emailSummaryCacheKey(first, { allowed: true }, "admin", "different-model"), key);
});

test("explicit refresh replaces the stored brief; failed refresh preserves it", async () => {
  const store = memoryStore();
  await reuseEmailSummary(store, "first", async () => output);
  const revised = output.replace("Confirm quantity", "Confirm colors");
  assert.equal((await reuseEmailSummary(store, "refresh", async () => revised, true)).cached, false);
  await assert.rejects(reuseEmailSummary(store, "failed", async () => { throw new Error("Provider down"); }, true), /Provider down/);
  assert.equal((await reuseEmailSummary(store, "reopen", async () => { throw new Error("Must not generate"); })).output, revised);
});

test("concurrent server workers generate once; failed and invalid generations release their leases", async () => {
  const store = memoryStore();
  let finish!: (output: string) => void;
  const generation = reuseEmailSummary(store, "worker-1", () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(reuseEmailSummary(store, "worker-2", async () => { throw new Error("Duplicate charge"); }), EmailSummaryPendingError);
  finish(output);
  await generation;
  assert.equal((await reuseEmailSummary(store, "worker-3", async () => { throw new Error("Duplicate charge"); })).cached, true);
  const empty = memoryStore();
  await assert.rejects(reuseEmailSummary(empty, "bad", async () => "invalid JSON"));
  assert.equal((await reuseEmailSummary(empty, "retry", async () => output)).output, output);
});

test("a cache completed between lookup and lease acquisition is reused", async () => {
  let reads = 0;
  const store: EmailSummaryStore = { read: async () => ++reads === 1 ? null : { output, generatedAt: "2026-11-09T01:00:00Z" }, claim: async () => true, complete: async () => { throw Error("Must not overwrite"); }, release: async () => {} };
  assert.equal((await reuseEmailSummary(store, "race", async () => { throw Error("Duplicate charge"); })).cached, true);
});

test("client remounts share in-flight work; later opens still check the API", async () => {
  let calls = 0;
  let finish!: (response: Response) => void;
  const fetcher = (async (_url, init) => {
    calls++;
    assert.equal((init?.signal as AbortSignal).aborted, false);
    return new Promise<Response>(resolve => { finish = resolve; });
  }) as typeof fetch;
  const body = JSON.stringify({ mode: "summary", text: "Unique in-flight buyer", language: "en", currentFollowUpAt: null });
  const first = requestEmailSummary(body, false, fetcher);
  const remount = requestEmailSummary(body.replace('"currentFollowUpAt":null', '"currentFollowUpAt":"2026-11-10T01:00:00Z"'), false, fetcher);
  assert.equal(first, remount);
  finish(Response.json({ ok: true, output, cached: false }));
  await first;
  assert.equal(calls, 1);
  const reopen = requestEmailSummary(body, false, fetcher);
  finish(Response.json({ ok: true, output, cached: true }));
  assert.equal((await reopen).cached, true);
  assert.equal(calls, 2);
});

test("client errors can be retried and refresh intent is explicit", async () => {
  let calls = 0;
  const body = JSON.stringify({ mode: "summary", text: "Unique failed buyer", language: "en" });
  const fetcher = (async (_url, init) => {
    assert.equal(JSON.parse(init?.body as string).refreshSummary, calls > 0);
    return ++calls === 1 ? Response.json({ ok: false, error: "Network problem" }, { status: 502 }) : Response.json({ ok: true, output });
  }) as typeof fetch;
  await assert.rejects(requestEmailSummary(body, false, fetcher), /Network problem/);
  assert.equal((await requestEmailSummary(body, true, fetcher)).summary.title, "PLA inquiry");
});
