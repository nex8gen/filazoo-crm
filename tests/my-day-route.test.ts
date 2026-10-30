import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(options: { denied?: boolean; failed?: boolean } = {}) {
  let reads = 0;
  const exports = {} as { GET: () => Promise<Response> };
  const deps: Record<string, unknown> = {
    "@/lib/auth": { getWorkspaceViewer: async () => options.denied ? null : { id: "member", role: "operator" } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({}) },
    "@/lib/data/my-day": { readMyDayData: async (_db: unknown, viewer: { id: string }) => { reads++; assert.equal(viewer.id, "member"); if (options.failed) throw new Error("private database details"); return { items: [], sources: [], asOf: "2026-10-30T08:00:00Z" }; } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/my-day/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => deps[id], Response });
  return { GET: exports.GET, reads: () => reads };
}
test("My Day refresh rejects unauthenticated requests without querying records", async () => {
  const api = load({ denied: true }); assert.equal((await api.GET()).status, 401); assert.equal(api.reads(), 0);
});
test("My Day refresh is private, uncached and uses the server-resolved member", async () => {
  const response = await load().GET(); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await response.json()).items, []);
});
test("My Day refresh reports a safe failure without leaking backend details", async () => {
  const response = await load({ failed: true }).GET(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private database/);
});
