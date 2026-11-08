import test from "node:test";
import assert from "node:assert/strict";
import { startVoiceInput, type VoiceRecognition } from "../lib/ai/voice-input.ts";
import { recoverAgentAction } from "../lib/ai/action-recovery.ts";

function voiceFixture() {
  const sessions: VoiceRecognition[] = [], changes: string[] = [], statuses: Array<string | null> = [], listening: boolean[] = [];
  let pending: (() => void) | undefined, aborts = 0;
  const controller = startVoiceInput({ value: "Order", language: "en-US", create: () => {
    const recognition: VoiceRecognition = { continuous: false, interimResults: false, lang: "", onresult: null, onerror: null, onend: null, start() {}, stop() {}, abort() { aborts++; } };
    sessions.push(recognition); return recognition;
  }, onChange: text => changes.push(text), onStatus: status => statuses.push(status), onListening: value => listening.push(value), schedule: callback => { pending = callback; return () => { pending = undefined; }; } });
  return { controller, sessions, changes, statuses, listening, aborts: () => aborts, resume() { const next = pending; pending = undefined; next?.(); } };
}

test("dictation recovers network interruptions and keeps text across recognition sessions", () => {
  const f = voiceFixture();
  f.sessions[0].onresult!({ results: [[{ transcript: "100 black PLA" }]] });
  f.sessions[0].onerror!({ error: "network" });
  assert.equal(f.sessions.length, 1); // Wait until recognition releases the microphone.
  f.sessions[0].onend!(); f.resume();
  assert.equal(f.sessions.length, 2);
  f.sessions[1].onresult!({ results: [[{ transcript: "for Acme" }]] });
  assert.equal(f.changes.at(-1), "Order 100 black PLA for Acme");
  f.controller.stop();
});

test("silence recovery is bounded and stopping cancels a queued voice restart", () => {
  const f = voiceFixture();
  for (let index = 0; index < 3; index++) {
    f.sessions[index].onerror!({ error: "no-speech" });
    f.sessions[index].onend!(); f.resume();
  }
  assert.equal(f.sessions.length, 3);
  assert.equal(f.listening.at(-1), false);
  assert.match(f.statuses.at(-1)!, /Tap the microphone/);
  const canceled = voiceFixture();
  canceled.sessions[0].onend!(); canceled.controller.stop(); canceled.resume();
  assert.equal(canceled.sessions.length, 1);
});

test("permission denial gives an actionable status and never retries microphone access", () => {
  const f = voiceFixture();
  const staleResult = f.sessions[0].onresult!;
  f.sessions[0].onerror!({ error: "not-allowed" });
  f.resume(); staleResult({ results: [[{ transcript: "late result" }]] });
  assert.equal(f.sessions.length, 1);
  assert.equal(f.changes.length, 0);
  assert.equal(f.aborts(), 1);
  assert.match(f.statuses.at(-1)!, /browser settings/);
});

test("lost action responses recover the committed result using only GET, including drafts and partial outcomes", async () => {
  const saved = { status: "completed", success: "Draft created.", href: "/email?agentDraft=test", draft: { to: "buyer@example.com" } };
  let calls = 0;
  const result = await recoverAgentAction("saved-id", { pause: async () => {}, fetcher: async (_url, init) => {
    assert.equal(init?.method, undefined);
    assert.equal(init?.cache, "no-store");
    calls++;
    if (calls === 1) throw new Error("Network interruption");
    return Response.json(calls === 2 ? { status: "running" } : saved);
  } });
  assert.equal(calls, 3);
  assert.deepEqual(result, saved);
  const partial = { status: "failed", success: "Invoice saved.", error: "Email not confirmed.", href: "/invoices/saved" };
  assert.deepEqual(await recoverAgentAction("saved-id", { fetcher: async () => Response.json(partial) }), partial);
});

test("unconfirmed actions remain unconfirmed and inaccessible results never trigger another write", async () => {
  const running = await recoverAgentAction("saved-id", { attempts: 2, pause: async () => {}, fetcher: async () => Response.json({ status: "running" }) });
  assert.equal(running.status, "running"); assert.equal(running.success, undefined);
  let reads = 0;
  const inaccessible = await recoverAgentAction("saved-id", { fetcher: async () => { reads++; return Response.json({ error: "Sign in." }, { status: 401 }); } });
  assert.equal(inaccessible.status, "unknown"); assert.equal(reads, 1);
});
