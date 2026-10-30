import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as analytics from "../lib/analytics-dashboard.ts";

type Call = { table: string; method: string; args: unknown[] };
function load(options: { denied?: boolean; failed?: string; total?: number; pageCap?: number } = {}) {
  let authorized = false;
  const calls: Call[] = [];
  const client = { from(table: string) {
    assert.ok(authorized, "authorize before constructing database queries");
    let start = 0, end = 499;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "or", "order", "eq", "is", "not", "range"]) query[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      if (method === "range") [start, end] = args as [number, number];
      return query;
    };
    query.then = async (resolve: (value: unknown) => void) => {
      if (table === options.failed) return resolve({ data: null, count: null, error: { message: "offline" } });
      if (table !== "companies") return resolve({ data: [], count: 0, error: null });
      const total = options.total ?? 1;
      const rows = Array.from({ length: Math.min(options.pageCap ?? 500, end - start + 1, Math.max(0, total - start)) }, (_, index) => ({ id: String(start + index), name: "Company", source: "manual", created_at: "2026-10-01T08:00:00Z", pipeline: [{ stage: "new", currency: "USD", estimated_value: "12.30", owner_id: "owner", next_followup_at: null }] }));
      return resolve({ data: rows, count: total, error: null });
    };
    return query;
  } };
  const deps: Record<string, unknown> = {
    "../analytics-dashboard.ts": analytics,
    "../auth.ts": { requireWorkspaceMember: async () => { if (options.denied) throw new Error("Denied"); authorized = true; return { id: "viewer" }; } },
    "../supabase/admin.ts": { createSupabaseAdmin: () => client },
    "./inventory.ts": { getInventoryState: async () => ({ status: { configured: false, stale: false, lastSyncedAt: null }, snapshots: [] }) },
  };
  const exports = {} as { getAnalyticsDashboardData: () => Promise<analytics.AnalyticsDashboardData> };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/analytics.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => deps[id] ?? {}, Date, Intl, console: { error() {} } });
  return { api: exports, calls };
}
test("analytics authorizes before data access and rejects inactive sessions", async () => {
  const denied = load({ denied: true });
  await assert.rejects(denied.api.getAnalyticsDashboardData(), /Denied/);
  assert.equal(denied.calls.length, 0);
});
test("analytics paginates past 5000 rows, including a smaller Data API page cap", async () => {
  const result = await load({ total: 5105, pageCap: 100 }).api.getAnalyticsDashboardData();
  assert.equal(result.companies.length, 5105);
  assert.equal(result.companies.at(-1)?.id, "5104");
  assert.equal("estimatedValue" in result.companies[0], false);
  assert.equal("stage" in result.companies[0], false);
});
test("private catalogs, assigned tasks and personal AI usage stay scoped to the viewer", async () => {
  const { api, calls } = load();
  await api.getAnalyticsDashboardData();
  for (const [table, field] of [["catalogs", "user_id"], ["crm_tasks", "assigned_to"], ["ai_usage_events", "user_id"]]) {
    assert.ok(calls.some(call => call.table === table && call.method === "eq" && call.args[0] === field && call.args[1] === "viewer"));
  }
  assert.ok(calls.some(call => call.table === "companies" && call.method === "or" && call.args[0] === "source.is.null,source.neq.sample_seed"));
  assert.ok(calls.some(call => call.table === "flow_runs" && call.method === "is" && call.args[0] === "flows.trigger_config->>flowScope"));
});
test("one backend failure marks the source unavailable and preserves other reports", async () => {
  const data = await load({ failed: "invoices" }).api.getAnalyticsDashboardData();
  assert.equal(data.sources.find(source => source.id === "invoices")?.ok, false);
  assert.equal(data.sources.find(source => source.id === "companies")?.ok, true);
  assert.equal(data.companies.length, 1);
});
