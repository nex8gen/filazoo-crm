import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { flowHistoryFilters } from "../lib/flow-history.ts";

function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URL, Response, Error, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return exports;
}

test("history route validates filters and pagination before querying and disables caching", async () => {
  let calls = 0;
  let missing = false;
  const route = load("../app/api/flows/[id]/history/route.ts", {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "viewer", role: "viewer" }) },
    "@/lib/flow-history": { flowHistoryFilters },
    "@/lib/data/flow-history": { listFlowHistory: async () => { calls++; if (missing) throw new Error("Workflow not found."); return { entries: [], hasMore: false }; } },
  });
  const id = "11111111-1111-4111-8111-111111111111";
  const get = async (query = "", flowId = id) => await route.GET(new Request(`https://crm.test/api/flows/${flowId}/history?${query}`), { params: Promise.resolve({ id: flowId }) }) as Response;
  for (const query of ["page=-1", "page=1.1", "page=1001", "kind=failed", `query=${"a".repeat(121)}`]) assert.equal((await get(query)).status, 400);
  assert.equal((await get("", "invalid")).status, 400);
  assert.equal(calls, 0);
  const response = await get("kind=actions&query=email");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  missing = true;
  assert.equal((await get()).status, 404);
});

test("history reads respect restricted company ownership and paginate without exposing definitions", async () => {
  let role = "bd_manager", assigned = false, found = true;
  const calls: Array<[string, unknown, unknown?]> = [];
  const db = { from: (table: string) => {
    calls.push(["table", table]);
    const builder = {
      select: (fields: string) => { if (table === "flow_change_history") assert.equal(fields, "id,version,actor_label,created_at,changes"); return builder; },
      eq: (key: string, value: unknown) => { calls.push([key, value]); return builder; },
      ilike: (key: string, value: unknown) => { calls.push([key, value]); return builder; },
      contains: (key: string, value: unknown) => { calls.push([key, JSON.stringify(value)]); return builder; },
      order: () => builder,
      range: async (from: number, to: number) => { calls.push(["range", from, to]); return { data: Array.from({ length: 26 }, (_, i) => ({ id: String(i) })), error: null }; },
      maybeSingle: async () => ({ data: table === "flows" ? found ? { id: "flow", trigger_config: { flowScope: "company", scopeCompanyId: "company" } } : null : assigned ? { company_id: "company" } : null, error: null }),
    };
    return builder;
  } };
  const history = load("../lib/data/flow-history.ts", {
    "server-only": {}, "../auth.ts": { requireWorkspaceMember: async () => ({ id: "member", role }) },
    "../supabase/admin.ts": { createSupabaseAdmin: () => db },
    "../flows.ts": { isEmailScopedFlow: (scope: { flowScope: string }) => ["email", "company"].includes(scope.flowScope) },
  });
  const options = { page: 2, query: "email_10%", kind: "actions" };
  await assert.rejects(history.listFlowHistory("flow", options), /Workflow not found/);
  assert.equal(calls.some(call => call[1] === "flow_change_history"), false);
  assigned = true;
  const result = await history.listFlowHistory("flow", options) as { entries: unknown[]; hasMore: boolean };
  assert.equal(result.entries.length, 25); assert.equal(result.hasMore, true);
  assert.ok(calls.some(call => call[0] === "summary" && call[1] === "%email\\_10\\%%"));
  assert.ok(calls.some(call => call[0] === "range" && call[1] === 50 && call[2] === 75));
  assert.ok(calls.some(call => call[0] === "changes" && call[1] === '[{"kind":"actions"}]'));
  role = "viewer"; calls.length = 0;
  await history.listFlowHistory("flow", { ...options, page: 0, kind: "all", query: "" });
  assert.equal(calls.some(call => call[1] === "pipeline"), false);
  found = false;
  await assert.rejects(history.listFlowHistory("missing", options), /Workflow not found/);
});
