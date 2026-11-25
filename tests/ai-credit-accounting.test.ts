import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as budget from "../lib/ai/budget.ts";
import * as budgetFetch from "../lib/ai/budget-fetch.ts";
import * as providerFetch from "../lib/ai/provider-fetch.ts";
import * as routing from "../lib/ai/model-routing.ts";
import * as usage from "../lib/ai/usage.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { nativeGatewayModels, generateCrmPlan } from "../lib/ai/native-agent.ts";
import { researchWithGateway } from "../lib/ai/google-web-research.ts";

const require = createRequire(import.meta.url);
const actor = "11111111-1111-4111-8111-111111111111";
const rate = { input: .0000002, output: .00000075, context: 1000000, webSearch: .01 };
function wallet(allowed = true) {
  let balance = 15_000_000, calls = 0;
  const reservations: number[] = [], settlements: number[] = [];
  const store: budgetFetch.AiBudgetStore = {
    reserve: async (owner, _model, micros) => {
      assert.equal(owner, actor);
      if (!allowed) return { allowed: false, reason: "credits_exhausted" };
      balance -= micros; reservations.push(micros);
      return { allowed: true, reservationId: String(reservations.length) };
    },
    settle: async (_owner, id, micros) => { balance += reservations[Number(id) - 1] - micros; settlements.push(micros); },
  };
  return { store, reservations, settlements, get balance() { return balance; }, get calls() { return calls; },
    transport: (() => { calls++; return Promise.resolve(Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }], usage: { input_tokens: 1000, output_tokens: 100 } })); }) as typeof fetch };
}
function load(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => deps[name] ?? require(name), fetch, Response, Request, URL, Headers, AbortSignal, TextEncoder, Buffer, console, process });
  return exports;
}

test("an injected history transport still reserves and settles credits for each text generation", async () => {
  for (const task of ["chat", "email", "reply", "workflow"] as const) {
    const w = wallet();
    const provider = load("../lib/ai/provider-fetch.ts", { "./budget.ts": budget, "./budget-fetch.ts": budgetFetch,
      "./budget-server.ts": { budgetedAiFetch: (owner: string, transport: typeof fetch) => budgetFetch.createBudgetedAiFetch(owner, w.store, async () => rate, transport) },
    });
    const gateway = load("../lib/ai/gateway.ts", { "./provider-fetch.ts": provider, "./model-routing.ts": routing, "./usage.ts": usage });
    const generate = gateway.generateGatewayText as typeof generateGatewayText;
    assert.equal(await generate({ token: "synthetic", task, usageUserId: actor, fetcher: w.transport, systemInstruction: "Test", prompt: "Hello" }), "Done");
    assert.equal(w.calls, 1); assert.equal(w.reservations.length, 1); assert.deepEqual(w.settlements, [275]);
    assert.equal(w.balance, 15_000_000 - 275);
  }
});

test("an exhausted wallet blocks an injected provider transport before it spends", async () => {
  const w = wallet(false);
  const guarded = budgetFetch.createBudgetedAiFetch(actor, w.store, async () => rate, w.transport);
  await assert.rejects(generateGatewayText({ token: "synthetic", usageUserId: actor, fetcher: guarded, systemInstruction: "Test", prompt: "Hello" }), /not enough AI credits/);
  assert.equal(w.calls, 0); assert.equal(w.settlements.length, 0);
});

test("already metered features are charged once and cannot be attributed to a different member", async () => {
  const w = wallet();
  const guarded = budgetFetch.createBudgetedAiFetch(actor, w.store, async () => rate, w.transport);
  assert.equal(await providerFetch.workspaceAiFetch(actor, guarded), guarded);
  await assert.rejects(providerFetch.workspaceAiFetch("other-member", guarded), /different workspace member/);
  await generateGatewayText({ token: "synthetic", usageUserId: actor, fetcher: guarded, systemInstruction: "Test", prompt: "Hello" });
  assert.equal(w.reservations.length, 1); assert.deepEqual(w.settlements, [275]);
  await assert.rejects(providerFetch.workspaceAiFetch(undefined, fetch), /active workspace member/);
});

test("native Agent mode deducts usage even when saved chat history is absent", async () => {
  const w = wallet();
  const guarded = budgetFetch.createBudgetedAiFetch(actor, w.store, async () => rate, async () => Response.json({
    id: "resp-synthetic", created_at: 1, model: routing.STANDARD_AI_MODEL, status: "completed",
    output: [{ type: "message", id: "msg-synthetic", role: "assistant", content: [{ type: "output_text", text: "Hello", annotations: [] }] }],
    usage: { input_tokens: 1000, output_tokens: 100 },
  }));
  const models = await nativeGatewayModels({ token: "synthetic", userId: actor, userText: "Hello", fetcher: guarded });
  const result = await generateCrmPlan({ ...models, prompt: "Hello", messages: [{ role: "user", content: "Hello" }], pathname: "/", language: "en", read: async () => ({}), searchEmails: async () => ({}), validateAction: () => {} });
  assert.equal(result.output, "Hello"); assert.deepEqual(w.settlements, [275]);
  assert.equal(w.balance, 14_999_725);
});

test("native Google search uses the wallet and settles SDK token totals plus search fees", async () => {
  const previous = process.env.AI_GATEWAY_API_KEY; process.env.AI_GATEWAY_API_KEY = "synthetic";
  const w = wallet();
  const guarded = budgetFetch.createBudgetedAiFetch(actor, w.store, async () => rate, async (_url, init) => {
    assert.match(String(_url), /\/v4\/ai\/language-model$/);
    const request = JSON.parse(String(init?.body));
    const search = request.tools[0].id === "google.google_search";
    return Response.json({ content: [{ type: "text", text: "Verified business" }], finishReason: { unified: "stop", raw: "STOP" }, warnings: [],
      usage: { inputTokens: { total: 1000 }, outputTokens: { total: 100, text: 60, reasoning: 40 } },
      providerMetadata: { google: search ? { groundingMetadata: { webSearchQueries: ["Example"], groundingChunks: [{ web: { uri: "https://example.com/about" } }] } }
        : { urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://example.com/about", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }] } } },
    });
  });
  try {
    const result = await researchWithGateway({ usageUserId: actor, fetcher: guarded, identity: { name: "Example" }, language: "en", checkedAt: "2026-11-25T01:00:00Z" });
    assert.equal(result.status, "complete");
    assert.deepEqual(w.settlements, [10_275, 275]);
    assert.equal(w.balance, 14_989_450);
  } finally { if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous; }
});
