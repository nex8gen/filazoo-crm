import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as myDay from "../lib/my-day.ts";

type Call = { table: string; method: string; args: unknown[] };
function load(options: { denied?: boolean; failed?: string; total?: number; pageCap?: number } = {}) {
  let authorized = false;
  const calls: Call[] = [];
  const client = { from(table: string) {
    assert.ok(authorized, "Authenticate before creating database queries");
    let start = 0, end = 499;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "order", "eq", "in", "not", "lte", "range"]) query[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      if (method === "range") [start, end] = args as [number, number];
      return query;
    };
    query.then = async (resolve: (value: unknown) => void) => {
      if (table === options.failed) return resolve({ data: null, count: null, error: { message: "offline" } });
      if (table !== "crm_tasks") return resolve({ data: [], count: 0, error: null });
      const total = options.total ?? 1;
      const rows = Array.from({ length: Math.min(options.pageCap ?? 500, end - start + 1, Math.max(0, total - start)) }, (_, index) => ({ id: String(start + index), title: "Task", company_id: null, companies: null, status: "open", due_at: null, priority: "normal" }));
      return resolve({ data: rows, count: total, error: null });
    };
    return query;
  } };
  const deps: Record<string, unknown> = {
    "../my-day.ts": myDay,
    "../auth.ts": { requireWorkspaceMember: async () => { if (options.denied) throw new Error("Denied"); authorized = true; return { id: "viewer", role: "operator" }; } },
    "../supabase/admin.ts": { createSupabaseAdmin: () => client },
  };
  const exports = {} as { getMyDayData: () => Promise<myDay.MyDayData> };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/my-day.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => deps[id] ?? {}, Date });
  return { api: exports, calls };
}
test("My Day denies inactive sessions before reading any records", async () => {
  const { api, calls } = load({ denied: true });
  await assert.rejects(api.getMyDayData(), /Denied/); assert.equal(calls.length, 0);
});
test("My Day scopes tasks, followups, invoice sources and reply requests to the current teammate", async () => {
  const { api, calls } = load(); await api.getMyDayData();
  for (const [table, column] of [["crm_tasks", "assigned_to"], ["pipeline", "owner_id"], ["invoices", "created_by"], ["invoices", "companies.pipeline.owner_id"], ["agent_reply_requests", "user_id"]]) {
    assert.ok(calls.some(call => call.table === table && call.method === "eq" && call.args[0] === column && call.args[1] === "viewer"), `${table}.${column}`);
  }
  assert.ok(calls.some(call => call.table === "agent_reply_requests" && call.method === "eq" && call.args[0] === "owner_role"));
});
test("My Day reads every page even when the server caps pages below the requested size", async () => {
  const data = await load({ total: 1105, pageCap: 100 }).api.getMyDayData(); assert.equal(data.items.length, 1105);
});
test("My Day reports one unavailable source without presenting the list as complete", async () => {
  const data = await load({ failed: "invoices" }).api.getMyDayData();
  assert.equal(data.items.length, 1); assert.equal(data.sources.filter(source => !source.ok).length, 2);
});
