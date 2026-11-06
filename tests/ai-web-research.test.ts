import test from "node:test";
import assert from "node:assert/strict";
import { researchWithGateway, researchQueries, GOOGLE_WEB_RESEARCH_MODEL, type ResearchGenerator } from "../lib/ai/google-web-research.ts";
import { trackAiUsage } from "../lib/ai/chat-usage.ts";

function token(t: test.TestContext) {
  const before = process.env.AI_GATEWAY_API_KEY; process.env.AI_GATEWAY_API_KEY = "synthetic";
  t.after(() => { if (before === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = before; });
}
const discovery = { text: "A possible business is described by these pages. Do not merge namesakes.", sources: [{ sourceType: "url", url: "https://example.com/about", title: "Official" }, { sourceType: "url", url: "https://registry.org/business", title: "Registry" }], providerMetadata: { google: { groundingMetadata: { webSearchQueries: ["Example Print Boston", "Example Print company website"], groundingChunks: [{ web: { uri: "https://example.com/about", title: "Official" } }], groundingSupports: [{ segment: { text: "Example Print provides printing services." }, groundingChunkIndices: [0] }] } } } };
const pages = { text: "The public pages describe a printing business. Employee count is unknown.", providerMetadata: { google: { urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://example.com/about", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }, { retrievedUrl: "https://registry.org/business", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }] } } } };
const options = { identity: { name: "Example Print", city: "Boston", country: "US" }, language: "en" as const, checkedAt: "2026-11-06T04:00:00Z", fetcher: async () => { throw new Error("No real network in this test"); } };

test("enabled research actually discovers with Google then reads multiple provider-returned sites", async t => {
  token(t); const calls: Parameters<ResearchGenerator>[0][] = [];
  const result = await researchWithGateway({ ...options, identity: { ...options.identity, privateNote: "PRIVATE_QUOTE_123" } as typeof options.identity,
    questions: ["Find employees and contact details. Private order value PRIVATE_DEAL_456"], generate: async input => { calls.push(input); return calls.length === 1 ? discovery : pages; } });
  assert.equal(result.status, "complete"); assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(calls[0].tools), ["google_search"]); assert.deepEqual(Object.keys(calls[1].tools), ["url_context"]);
  assert.equal(calls[0].maxRetries, 0); assert.equal(calls[1].maxRetries, 0);
  assert.equal(typeof calls[0].model === "object" && calls[0].model.modelId, GOOGLE_WEB_RESEARCH_MODEL);
  assert.equal(result.queries.length, 2); assert.equal(result.visitedUrls?.length, 2);
  assert.match(result.findings, /printing business/); assert.match(result.findings, /"sources":\["W1"\]/);
  assert.doesNotMatch(JSON.stringify(calls.map(call => [call.prompt, call.system])), /PRIVATE_QUOTE_123|PRIVATE_DEAL_456/);
  assert.match(calls[0].system, /unconfirmed.*namesakes|namesakes.*unconfirmed/);
});
test("ungrounded text, missing actual searches and invented links never become verified facts", async t => {
  token(t);
  for (const output of [{ text: "Fabricated 500 employees" }, { ...discovery, providerMetadata: {} }, { text: "[Invented](https://example.com/fiction)", providerMetadata: { google: { groundingMetadata: { webSearchQueries: ["Example"] } } } }]) {
    let calls = 0;
    const result = await researchWithGateway({ ...options, generate: async () => { calls++; return output; } });
    assert.equal(result.status, "no_results"); assert.equal(calls, 2); assert.equal(result.sources.length, 0); assert.equal(result.findings, "");
    assert.match(result.warning!, /after a retry/);
  }
});

test("missing search execution gets one bounded retry and keeps personal email out of provider prompts", async t => {
  token(t); const calls: Parameters<ResearchGenerator>[0][] = [];
  const result = await researchWithGateway({ ...options, identity: { ...options.identity, email: "private-buyer@gmail.com" }, generate: async input => {
    calls.push(input);
    return calls.length === 1 ? { text: "", finishReason: "stop" } : calls.length === 2 ? discovery : pages;
  } });
  assert.equal(result.status, "complete"); assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => Object.keys(call.tools)[0]), ["google_search", "google_search", "url_context"]);
  assert.deepEqual(calls[0].providerOptions?.gateway.order, ["google", "vertex"]);
  assert.match(calls[1].system, /Do not write or execute Python/);
  assert.doesNotMatch(JSON.stringify(calls.map(call => call.prompt)), /private-buyer/);
});

test("Vertex grounding survives an empty Google metadata object and omitted query list", async t => {
  token(t); let calls = 0;
  const result = await researchWithGateway({ ...options, generate: async () => ++calls === 1
    ? { ...discovery, providerMetadata: { google: {}, googleVertex: { groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/about" } }] } } } }
    : pages });
  assert.equal(calls, 2); assert.equal(result.status, "complete"); assert.equal(result.queries.length, 0);
  assert.ok(result.sources.some(source => source.url === "https://example.com/about"));
});

test("truncated discovery retains provider-returned sources for page verification", async t => {
  token(t); let calls = 0;
  const result = await researchWithGateway({ ...options, generate: async input => {
    if (++calls === 1) return { ...discovery, finishReason: "length", text: "An unfinished factual claim" };
    assert.doesNotMatch(input.prompt, /unfinished factual claim/);
    return pages;
  } });
  assert.equal(calls, 2); assert.equal(result.status, "complete"); assert.equal(result.visitedUrls?.length, 2);
});

test("Google citation redirects resolve to public pages without following arbitrary redirects", async t => {
  token(t); let calls = 0; const requests: string[] = [];
  const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/verified";
  const result = await researchWithGateway({ ...options, fetcher: async (input, init) => {
    requests.push(String(input)); assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://official-company.com/about" } });
  }, generate: async input => {
    if (++calls === 1) return { ...discovery, sources: [{ sourceType: "url", url: redirect }], providerMetadata: { google: { groundingMetadata: { webSearchQueries: ["Company"], groundingChunks: [{ web: { uri: redirect } }] } } } };
    assert.match(input.prompt, /https:\/\/official-company.com\/about/);
    assert.doesNotMatch(input.prompt, /grounding-api-redirect/);
    return { text: "The official page was read.", providerMetadata: { google: { urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://official-company.com/about", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }] } } } };
  } });
  assert.deepEqual(requests, [redirect]); assert.deepEqual(result.visitedUrls, ["https://official-company.com/about"]);
  assert.equal(result.sources[0].url, "https://official-company.com/about");
});

test("private redirect destinations are rejected and resolving a citation never counts as reading it", async t => {
  token(t); let calls = 0;
  const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/verified";
  const result = await researchWithGateway({ ...options, fetcher: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }), generate: async input => {
    if (++calls === 1) return { ...discovery, sources: [{ sourceType: "url", url: redirect }], providerMetadata: { google: { groundingMetadata: { webSearchQueries: ["Company"], groundingChunks: [{ web: { uri: redirect } }] } } } };
    assert.doesNotMatch(input.prompt, /127\.0\.0\.1/);
    return { text: "No pages read" };
  } });
  assert.deepEqual(result.visitedUrls, []); assert.equal(result.sources[0].url, redirect);
});
test("page failures retain real search evidence with an explicit warning and no visited-page claim", async t => {
  token(t); let calls = 0;
  const result = await researchWithGateway({ ...options, generate: async () => { if (++calls === 1) return discovery; throw new Error("private provider error"); } });
  assert.equal(result.status, "complete"); assert.equal(result.sources.length, 2); assert.equal(result.visitedUrls?.length, 0);
  assert.match(result.warning!, /search evidence only/); assert.doesNotMatch(JSON.stringify(result), /private provider error/);
});
test("only successful public page receipts count; model-written URLs do not enter the read list", async t => {
  token(t); let calls = 0;
  const result = await researchWithGateway({ ...options, generate: async input => {
    if (++calls === 1) return { ...discovery, text: "[Unverified](https://invented.org/fiction)" };
    assert.doesNotMatch(input.prompt, /invented\.org/);
    return { text: "One public page was read.", providerMetadata: { google: { urlContextMetadata: { urlMetadata: [
      { retrievedUrl: "https://example.com/about", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" },
      { retrievedUrl: "https://registry.org/business", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_PAYWALL" },
      { retrievedUrl: "http://127.0.0.1/private", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" },
    ] } } } };
  } });
  assert.deepEqual(result.visitedUrls, ["https://example.com/about"]);
  assert.ok(result.sources.every(source => !source.url.includes("127.0.0.1")));
});
test("query and page budgets are bounded, and cancellation stops before provider execution", async t => {
  token(t);
  const queries = researchQueries({ ...options.identity, contact: "Buyer\nName", website: "https://example.com" });
  assert.ok(queries.length <= 4); assert.ok(queries.every(query => query.length <= 200 && !query.includes("\n")));
  let calls = 0; const controller = new AbortController(); controller.abort();
  const result = await researchWithGateway({ ...options, signal: controller.signal, generate: async () => { calls++; return discovery; } });
  assert.equal(result.status, "unavailable"); assert.equal(calls, 0);
});
test("native Gateway search and URL-reading usage retain model identity and token counts", async () => {
  const tracker = trackAiUsage(async () => Response.json({ usage: { inputTokens: { total: 123, cacheRead: 0 }, outputTokens: { total: 45 } } }));
  await tracker.fetcher("https://ai-gateway.vercel.sh/v3/ai/language-model", { method: "POST", headers: { "ai-language-model-id": GOOGLE_WEB_RESEARCH_MODEL }, body: JSON.stringify({ maxOutputTokens: 1800 }) });
  assert.equal(tracker.usage[0].model, GOOGLE_WEB_RESEARCH_MODEL); assert.equal(tracker.usage[0].inputTokens, 123); assert.equal(tracker.usage[0].outputTokens, 45);
});
