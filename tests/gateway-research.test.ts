import test from "node:test";
import assert from "node:assert/strict";
import { researchWithGateway } from "../lib/ai/gateway-research.ts";

test("research accepts only native citations or links actually retrieved by the search tool", async () => {
  const previous = { key: process.env.AI_GATEWAY_API_KEY, budget: process.env.AI_BUDGET_ENFORCEMENT };
  process.env.AI_GATEWAY_API_KEY = "synthetic";
  process.env.AI_BUDGET_ENFORCEMENT = "false";
  try {
    for (const scenario of ["native", "retrieved", "invented", "no-tool"]) {
      const result = await researchWithGateway({ identity: { name: "Synthetic Business" }, language: "en", checkedAt: "2026-11-05T01:00:00Z", fetcher: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        assert.deepEqual(request.include, ["web_search_call.action.sources"]);
        assert.equal("reasoning" in request, false);
        return Response.json({ status: "completed", output: [
          ...(scenario === "no-tool" ? [] : [{ type: "web_search_call", action: { sources: [{ type: "url", url: "https://example.com/verified" }] } }]),
          { type: "message", content: [{ type: "output_text", text: scenario === "invented" ? "[Claim](https://example.com/invented)" : "[Verified business](https://example.com/verified)", annotations: scenario === "native" ? [{ type: "url_citation", url: "https://example.com/verified", title: "Verified business" }] : [] }] },
        ] });
      } });
      assert.equal(result.status, scenario === "no-tool" ? "unavailable" : scenario === "invented" ? "no_results" : "complete");
      assert.equal(result.sources.length, ["native", "retrieved"].includes(scenario) ? 1 : 0);
    }
  } finally {
    if (previous.key === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous.key;
    if (previous.budget === undefined) delete process.env.AI_BUDGET_ENFORCEMENT; else process.env.AI_BUDGET_ENFORCEMENT = previous.budget;
  }
});
