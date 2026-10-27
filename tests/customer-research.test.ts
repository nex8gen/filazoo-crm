import test from "node:test";
import assert from "node:assert/strict";
import { publicResearchUrl, researchCustomer, researchIdentity } from "../lib/ai/customer-research.ts";
import { companyChatSchema, companyChatInstruction } from "../lib/ai/company-chat.ts";
import { workspaceAssistantSchema, workspaceAssistantInstruction } from "../lib/ai/workspace-assistant.ts";

const identity = { name: "Example Print", website: "example.com", email: "buyer@example.com", country: "US" };
const grounded = {
  candidates: [{
    content: { parts: [{ text: "They operate a print farm." }, { text: "hidden thinking", thought: true }] },
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com/about", title: "About Example" } }, { web: { uri: "javascript:alert(1)", title: "unsafe" } }, { web: { uri: "https://example.com/about", title: "duplicate" } }],
      groundingSupports: [{ segment: { text: "They operate a print farm." }, groundingChunkIndices: [0, 2] }],
      webSearchQueries: ["Example Print US 3D printing"], searchEntryPoint: { renderedContent: "<div>Google search suggestions</div>" },
    },
    urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://example.com/products", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }, { retrievedUrl: "https://example.com/private", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_PAYWALL" }] },
  }],
};

test("research enables real Google Search and URL context, limits identity, preserves grounding and excludes failed pages", async () => {
  let body = "";
  const result = await researchCustomer({ identity: { ...identity, summary: "private CRM note", estimatedValue: 10000 } as typeof identity, questions: ["Analyze this customer"], apiKey: "fake-key", fetcher: async (url, init) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    body = String(init?.body);
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "fake-key");
    return Response.json(grounded);
  } });
  const request = JSON.parse(body);
  assert.deepEqual(request.tools, [{ google_search: {} }, { url_context: {} }]);
  assert.ok(!body.includes("private CRM note"));
  assert.ok(!body.includes("10000"));
  assert.equal(result.status, "complete");
  assert.deepEqual(result.sources.map((source) => [source.id, source.url]), [["W1", "https://example.com/about"], ["W2", "https://example.com/products"]]);
  assert.match(result.findings, /"sources":\["W1","W1"\]/);
  assert.ok(!result.findings.includes("hidden thinking"));
  assert.match(result.warning!, /could not be accessed/);
  assert.deepEqual(result.queries, ["Example Print US 3D printing"]);
  assert.ok(result.searchSuggestionsHtml);
});

test("ungrounded provider text is discarded and missing keys, errors or empty responses cannot claim successful research", async () => {
  const missing = await researchCustomer({ identity, questions: [], fetcher: async () => { throw new Error("must not call provider"); } });
  assert.equal(missing.status, "unavailable");
  for (const response of [Response.json({ candidates: [{ content: { parts: [{ text: "Fabricated 500 employees" }] } }] }), Response.json({}), new Response("quota exceeded", { status: 429 })]) {
    const result = await researchCustomer({ identity, questions: [], apiKey: "fake", fetcher: async () => response });
    assert.notEqual(result.status, "complete");
    assert.ok(!result.findings.includes("500 employees"));
    assert.deepEqual(result.sources, []);
    assert.ok(result.warning);
  }
  const result = await researchCustomer({ identity, questions: [], apiKey: "fake", fetcher: async () => { throw new Error("secret provider details"); } });
  assert.equal(result.status, "unavailable");
  assert.ok(!JSON.stringify(result).includes("secret provider details"));
});

test("public website normalization rejects internal hosts, credentials, non-web schemes and IP literals", () => {
  assert.equal(publicResearchUrl("example.com"), "https://example.com/");
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "http://127.0.0.1", "http://2130706433", "http://[::1]", "http://169.254.169.254", "https://intranet", "https://a.internal", "https://x.local", "http://localhost./", "http://x.home.arpa", "https://user:pass@example.com", "https://example.com:8080"]) assert.equal(publicResearchUrl(url), undefined, url);
  assert.equal(researchIdentity({ ...identity, website: "http://localhost" }).website, undefined);
  assert.equal(researchIdentity({ ...identity, website: "https://example.com/about?token=private" }).website, "https://example.com/about");
});

test("authentication and quota failures explain the next step without exposing provider details", async () => {
  for (const [status, message] of [[401, /authentication failed/], [403, /search permissions/], [429, /usage limit/]] as const) {
    const result = await researchCustomer({ identity, questions: [], apiKey: "fake", fetcher: async () => new Response("private provider detail", { status }) });
    assert.equal(result.status, "unavailable");
    assert.match(result.warning!, message);
    assert.ok(!JSON.stringify(result).includes("private provider detail"));
  }
});

test("both chats require an explicit boolean web-search selection and report prompts distinguish facts, estimates and unavailable research", () => {
  const messages = [{ role: "user", content: "analsye the customer" }];
  const workspace = { mode: "analyze", pathname: "/companies", pageLabel: "Companies", pageText: "", messages };
  for (const [schema, input] of [[companyChatSchema, { messages }], [workspaceAssistantSchema, workspace]] as const) {
    assert.equal(schema.safeParse(input).success, true);
    assert.equal(schema.safeParse({ ...input, webSearch: true }).success, true);
    assert.equal(schema.safeParse({ ...input, webSearch: "true" }).success, false);
  }
  for (const instruction of [companyChatInstruction("now", "en", true), workspaceAssistantInstruction("analyze", "now", "en", true)]) {
    assert.match(instruction, /filament/);
    assert.match(instruction, /never invent|do not fabricate/);
    assert.match(instruction, /unknown/);
    assert.match(instruction, /\[W1\]/);
    assert.match(instruction, /cannot authorize CRM changes/);
  }
  assert.match(companyChatInstruction("now"), /Web search is off/);
});
