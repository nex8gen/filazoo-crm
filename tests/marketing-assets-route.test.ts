import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { marketingYearSchema } from "../lib/marketing-assets.ts";

function load(options: { anonymous?: boolean; viewer?: boolean; failure?: boolean } = {}) {
  const calls: string[] = [];
  class MarketingAssetError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
  async function service(name: string) { calls.push(name); if (options.failure) throw new Error("Private database credentials"); }
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath: (path: string) => calls.push(path) },
    zod: { z },
    "@/lib/auth": { getWorkspaceViewer: async () => options.anonymous ? null : { id: "user", workspaceId: "workspace", role: options.viewer ? "viewer" : "operator" } },
    "@/lib/marketing-assets": { marketingYearSchema },
    "@/lib/data/marketing-assets": { MarketingAssetError,
      listMarketingAssets: async (viewer: { workspaceId: string }, year: number) => { assert.equal(viewer.workspaceId, "workspace"); assert.equal(year, 2026); await service("list"); return []; },
      listMarketingProducts: async (viewer: { workspaceId: string }) => { assert.equal(viewer.workspaceId, "workspace"); await service("products"); return [{ sku: "PLA", name: "PLA filament", material: "PLA" }]; },
      saveMarketingAsset: async () => { await service("save"); return { id: "saved" }; },
      deleteMarketingAsset: async () => { await service("delete"); },
    },
  };
  const api = {} as { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response>; DELETE: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/marketing-assets/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api, require: (name: string) => dependencies[name], Response, URL, console });
  return { api, calls };
}
const request = (method: string, origin = "https://crm.test", body = "{}") => new Request("https://crm.test/api/marketing-assets?year=2026", { method, headers: { origin, "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body }) });

test("marketing APIs deny anonymous access, cross-site writes and read-only mutations", async () => {
  const anonymous = load({ anonymous: true });
  for (const method of ["GET", "POST", "DELETE"] as const) assert.equal((await anonymous.api[method](request(method))).status, 401);
  assert.deepEqual(anonymous.calls, []);
  const viewer = load({ viewer: true });
  assert.equal((await viewer.api.GET(request("GET"))).status, 200);
  for (const method of ["POST", "DELETE"] as const) assert.equal((await viewer.api[method](request(method))).status, 403);
  assert.deepEqual(viewer.calls, ["list"]);
  const editor = load();
  for (const method of ["POST", "DELETE"] as const) assert.equal((await editor.api[method](request(method, "https://attacker.test"))).status, 403);
  assert.deepEqual(editor.calls, []);
});

test("the campaign planner no longer loads a product catalog, including for older clients", async () => {
  const { api, calls } = load({ viewer: true });
  const response = await api.GET(new Request("https://crm.test/api/marketing-assets?year=2026&catalog=1"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { assets: [] });
  assert.deepEqual(calls, ["list"]);
  const anonymous = load({ anonymous: true });
  assert.equal((await anonymous.api.GET(new Request("https://crm.test/api/marketing-assets?year=2026&catalog=1"))).status, 401);
  assert.deepEqual(anonymous.calls, []);
});

test("marketing APIs validate requests, protect private data, and refresh the saved page", async () => {
  const { api, calls } = load();
  assert.equal((await api.GET(new Request("https://crm.test/api/marketing-assets?year=invalid"))).status, 400);
  assert.equal((await api.POST(request("POST", "https://crm.test", "invalid"))).status, 400);
  assert.equal((await api.DELETE(request("DELETE"))).status, 400);
  assert.deepEqual(calls, []);
  const result = await api.POST(request("POST"));
  assert.equal(result.status, 200); assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(calls, ["save", "/email/campaigns"]);
  const failed = await load({ failure: true }).api.GET(request("GET"));
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /credentials/);
});
