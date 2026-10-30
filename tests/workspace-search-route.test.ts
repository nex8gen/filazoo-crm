import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as search from "../lib/workspace-search.ts";

function load(options: { denied?: boolean; failed?: boolean } = {}) {
  let reads = 0;
  const exports = {} as { GET: (request: Request) => Promise<Response> };
  const deps: Record<string, unknown> = {
    "@/lib/workspace-search": search,
    "@/lib/auth": { getWorkspaceViewer: async () => options.denied ? null : { id: "member", role: "viewer" } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({}) },
    "@/lib/data/workspace-search": { readWorkspaceSearch: async (_db: unknown, viewer: { id: string }, query: string) => { reads++; assert.equal(viewer.id, "member"); if (options.failed) throw new Error("Private database details"); return { query, results: [], unavailable: [] }; } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/workspace/search/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => deps[id], Response, URL });
  return { GET: exports.GET, reads: () => reads };
}
const request = (query: string) => new Request(`https://crm.test/api/workspace/search?q=${encodeURIComponent(query)}&user_id=someone-else`);
test("record search denies unauthenticated requests before touching the database", async () => {
  const api = load({ denied: true }); assert.equal((await api.GET(request("Acme"))).status, 401); assert.equal(api.reads(), 0);
});
test("record search rejects invalid terms and allows Chinese with no shared caching", async () => {
  const api = load();
  for (const query of ["", "a", "**", "x".repeat(121)]) assert.equal((await api.GET(request(query))).status, 400);
  assert.equal(api.reads(), 0);
  const response = await api.GET(request(" 测试 ")); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal((await response.json()).query, "测试");
});
test("record search hides backend error details", async () => {
  const response = await load({ failed: true }).GET(request("Acme")); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /Private database/);
});
