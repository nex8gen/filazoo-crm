import test from "node:test";
import assert from "node:assert/strict";
import { researchWithGateway } from "../lib/ai/gateway-research.ts";

test("research uses native Google tools through Gateway and accepts only provider-grounded sources", async () => {
  const previous = { key: process.env.AI_GATEWAY_API_KEY, budget: process.env.AI_BUDGET_ENFORCEMENT };
  process.env.AI_GATEWAY_API_KEY = "synthetic";
  process.env.AI_BUDGET_ENFORCEMENT = "true";
  try {
    for (const scenario of ["native", "retrieved", "invented", "no-tool"]) {
      let calls = 0;
      const result = await researchWithGateway({ identity: { name: "Synthetic Business" }, language: "en", checkedAt: "2026-11-05T01:00:00Z", fetcher: async (_url, init) => {
        calls++;
        assert.match(String(_url), /\/language-model$/);
        assert.equal(new Headers(init?.headers).get("ai-language-model-id"), "google/gemini-2.5-flash-lite");
        assert.equal(new Headers(init?.headers).get("ai-gateway-auth-method"), "api-key");
        const request = JSON.parse(String(init?.body));
        assert.equal(request.tools[0].id, calls === 1 || ["invented", "no-tool"].includes(scenario) ? "google.google_search" : "google.url_context");
        return Response.json({ content: [
          { type: "text", text: scenario === "invented" ? "[Claim](https://example.com/invented)" : "Verified business" },
          ...(scenario === "native" ? [{ type: "source", sourceType: "url", id: "source-1", url: "https://example.com/verified", title: "Verified" }] : []),
        ], finishReason: { unified: "stop", raw: "STOP" }, warnings: [],
        usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 50, text: 50, reasoning: 0 } },
        providerMetadata: { google: {
          groundingMetadata: { webSearchQueries: scenario === "no-tool" ? [] : ["Synthetic Business"], groundingChunks: scenario === "retrieved" ? [{ web: { uri: "https://example.com/verified", title: "Verified" } }] : [] },
          ...(calls === 2 && ["native", "retrieved"].includes(scenario) ? { urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://example.com/verified", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }] } } : {}),
        } } });
      } });
      assert.equal(result.status, ["no-tool", "invented"].includes(scenario) ? "no_results" : "complete");
      assert.equal(result.sources.length, ["native", "retrieved"].includes(scenario) ? 1 : 0);
      assert.equal(calls, 2);
    }
  } finally {
    if (previous.key === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous.key;
    if (previous.budget === undefined) delete process.env.AI_BUDGET_ENFORCEMENT; else process.env.AI_BUDGET_ENFORCEMENT = previous.budget;
  }
});

test("native Google research uses request-scoped OIDC without mislabeling it as an API key", async () => {
  const previous = process.env.AI_GATEWAY_API_KEY;
  const symbol = Symbol.for("@vercel/request-context");
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const oldContext = globals[symbol];
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.synthetic`;
  delete process.env.AI_GATEWAY_API_KEY;
  globals[symbol] = { get: () => ({ headers: { "x-vercel-oidc-token": token } }) };
  let calls = 0;
  try {
    const result = await researchWithGateway({ identity: { name: "Synthetic Business" }, language: "en", checkedAt: "2026-11-06T00:00:00Z", fetcher: async (_url, init) => {
      calls++;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${token}`);
      assert.equal(headers.get("ai-gateway-auth-method"), "oidc");
      return Response.json({ content: [{ type: "text", text: "No evidence" }], finishReason: { unified: "stop", raw: "STOP" }, warnings: [], usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } } });
    } });
    assert.equal(calls, 2);
    assert.equal(result.status, "no_results");
  } finally {
    if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous;
    if (oldContext === undefined) delete globals[symbol]; else globals[symbol] = oldContext;
  }
});

test("the actual unexpected executableCode response retries search instead of becoming a no-results report", async () => {
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "synthetic";
  let calls = 0;
  try {
    const result = await researchWithGateway({ identity: { name: "Synthetic Business" }, language: "en", checkedAt: "2026-11-06T00:00:00Z", fetcher: async (_url, init) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.tools[0].id, calls <= 2 ? "google.google_search" : "google.url_context");
      return Response.json({ content: calls === 1
        ? [{ type: "tool-call", toolCallId: "unexpected-code", toolName: "code_execution", input: '{"language":"PYTHON","code":"print(google_search.search())"}', providerExecuted: true }]
        : [{ type: "text", text: "A possible business, identity not confirmed." }, { type: "source", sourceType: "url", id: "one", url: "https://example.com/company", title: "Business" }],
        finishReason: { unified: "stop", raw: "STOP" }, warnings: [], usage: { inputTokens: { total: 100 }, outputTokens: { total: 50 } },
        providerMetadata: { google: calls === 2 ? { groundingMetadata: { webSearchQueries: ["Synthetic Business"] } } : calls === 3 ? { urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://example.com/company", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }] } } : {} } });
    } });
    assert.equal(calls, 3); assert.equal(result.status, "complete");
    assert.deepEqual(result.visitedUrls, ["https://example.com/company"]);
    assert.doesNotMatch(result.findings, /PYTHON|google_search.search/);
  } finally {
    if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous;
  }
});
