import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { summarizeSegmentWorkflows, type SegmentWorkflowMetric } from "../lib/segment-workflow-metrics.ts";
import { isEmailScopedFlow } from "../lib/flows.ts";

type Row = Record<string, unknown>;
function fixture(role: string | null = "admin", fail = false) {
  const rows: Record<string, Row[]> = {
    flows: [
      { id: "flow", name: "Segment workflow", status: "live", trigger_type: "company_segment_changed", trigger_config: { segment: "Wholesale" } },
      { id: "private", name: "Other customer's workflow", status: "live", trigger_type: "company_segment_changed", trigger_config: { segment: "Wholesale", flowScope: "company", scopeCompanyId: "other" } },
      { id: "general", name: "General workflow", status: "live", trigger_type: "new_lead", trigger_config: { segment: "Wholesale" } },
    ],
    flow_runs: Array.from({ length: 1205 }, (_, i) => ({ id: `run-${i}`, flow_id: "flow", company_id: i % 2 ? "other" : "assigned", status: "active" })),
    flow_run_logs: Array.from({ length: 1205 }, (_, i) => ({ id: `log-${i}`, run_id: `run-${i}`, result: { action: "email_sent", messageId: `message-${i}` } })),
  };
  const calls: string[] = [];
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "../auth.ts": { requireWorkspaceMember: async () => { if (!role) throw new Error("Access denied"); return { role }; } },
    "./crm.ts": { getCrmDataMode: () => "live" },
    "../flows.ts": { isEmailScopedFlow },
    "../segment-workflow-metrics.ts": { summarizeSegmentWorkflows },
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from(table: string) {
      calls.push(table);
      let data = [...rows[table]];
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { data = data.filter(row => key === "result->>action" ? (row.result as Row).action === value : row[key] === value); return query; },
        in(key: string, values: unknown[]) { data = data.filter(row => values.includes(row[key])); return query; },
        order() { return query; },
        range(from: number, to: number) { data = data.slice(from, to + 1); return query; },
        async throwOnError() { if (fail) throw new Error("Database unavailable"); return { data }; },
      };
      return query;
    } }) },
  };
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/segment-workflows.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { load: exports.listSegmentWorkflowMetrics as (ids: string[]) => Promise<SegmentWorkflowMetric[]>, calls, rows };
}

test("workflow history paginates beyond the Data API limit and excludes general workflows", async () => {
  const app = fixture();
  const result = await app.load([]);
  assert.equal(result.length, 2);
  assert.equal(result[0].active, 1205);
  assert.equal(result[0].emailsSent, 1205);
  assert.ok(app.calls.filter(table => table === "flow_runs").length > 1);
});

test("managers receive only assigned-company activity and cannot see unrelated scoped workflows", async () => {
  const app = fixture("bd_manager");
  const result = await app.load(["assigned"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].active, 603);
  assert.equal(result[0].emailsSent, 603);
  const empty = await app.load([]);
  assert.equal(empty[0].active, 0);
  assert.equal(empty[0].emailsSent, 0);
});

test("read-only viewers may inspect activity, auth failures stop queries and database errors propagate", async () => {
  assert.equal((await fixture("viewer").load([]))[0].emailsSent, 1205);
  const denied = fixture(null);
  await assert.rejects(() => denied.load([]), /Access denied/);
  assert.equal(denied.calls.length, 0);
  await assert.rejects(() => fixture("admin", true).load([]), /Database unavailable/);
});
