import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { marketingAssetInputSchema, newMarketingAsset } from "../lib/marketing-assets.ts";

function load(options: { anonymous?: boolean; viewer?: boolean; deny?: boolean; productsAllowed?: boolean; fail?: boolean } = {}) {
  let generated = 0, catalogReads = 0;
  let prompt = "";
  class AiPolicyError extends Error {}
  const deps: Record<string, unknown> = {
    "@/lib/auth": { getWorkspaceViewer: async () => options.anonymous ? null : { id: "user", workspaceId: "trusted-workspace", role: options.viewer ? "viewer" : "operator" } },
    "@/lib/marketing-assets": { marketingAssetInputSchema },
    "@/lib/data/ai-settings": { requireAiFeature: async () => ({ actions: { emailDrafts: options.deny ? "deny" : "review" }, data: { products: options.productsAllowed, customers: false } }) },
    "@/lib/ai-policy": { AiPolicyError, aiBehaviorInstruction: () => " Workspace policy." },
    "@/lib/ai/provider-credentials": { resolveGatewayTokenAsync: async () => "server-only-token" },
    "@/lib/ai/budget-server": { budgetedAiFetch: () => fetch },
    "@/lib/ai/gateway": { generateGatewayText: async (input: { prompt: string }) => { generated++; prompt = input.prompt; if (options.fail) throw new Error("Private provider credentials"); return "Subject: Partner offer\nRequest a quote."; } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => { catalogReads++; return { select: () => ({ in: () => ({ eq: async () => ({ data: [{ sku: "PLA", name: "Verified catalog product", material: "PLA" }], error: null }) }) }) }; } }) },
    "@/lib/workspace-context": { withWorkspaceViewer: async (viewer: { workspaceId: string }, work: () => Promise<Response>) => { assert.equal(viewer.workspaceId, "trusted-workspace"); return work(); } },
  };
  const api = {} as { POST: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/marketing-assets/draft/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api, require: (name: string) => deps[name], Response, URL, console });
  return { api, state: () => ({ generated, catalogReads, prompt }) };
}
const asset = { ...newMarketingAsset("factory_sale", 2026), offer: "Ask for partner pricing", audience: "Private audience", productSkus: ["PLA"] };
const request = (body: unknown = asset, origin = "https://crm.test") => new Request("https://crm.test/api/marketing-assets/draft", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("AI drafting rejects unauthorized, cross-site, disabled-policy and invalid requests without a model call", async () => {
  for (const options of [{ anonymous: true }, { viewer: true }, { deny: true }]) {
    const route = load(options); assert.ok([401, 403].includes((await route.api.POST(request())).status)); assert.equal(route.state().generated, 0);
  }
  const route = load(); assert.equal((await route.api.POST(request(asset, "https://attacker.test"))).status, 403);
  assert.equal((await route.api.POST(request({ ...asset, offer: "" }))).status, 400); assert.equal(route.state().generated, 0);
});

test("AI drafting enforces data permissions and reads allowed products inside the trusted workspace", async () => {
  const restricted = load(); const response = await restricted.api.POST(request()); assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(restricted.state().catalogReads, 0);
  assert.doesNotMatch(restricted.state().prompt, /Private audience|Verified catalog product/);
  const allowed = load({ productsAllowed: true }); assert.equal((await allowed.api.POST(request())).status, 200);
  assert.equal(allowed.state().catalogReads, 1); assert.match(allowed.state().prompt, /Verified catalog product/);
});

test("AI errors keep provider details private", async () => {
  const response = await load({ fail: true }).api.POST(request()); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /credentials|server-only-token/);
});
