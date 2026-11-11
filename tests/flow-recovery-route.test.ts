import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as recovery from "../lib/flow-recovery.ts";

type Row = Record<string, unknown>;
function fixture(viewer = { id: "owner", role: "bd_manager" }) {
  const run: Row = { id: "run", flow_id: "flow", current_step: 3, status: "failed", locked_at: null,
    context: { executionCheckpoint: { phase: "preparing", stepId: "current" } }, flow_run_logs: [] };
  const tables: Record<string, Row[]> = { flows: [{ id: "flow", user_id: "owner", status: "live" }], flow_runs: [run],
    flow_run_logs: [{ run_id: "run", result: { action: "response_claimed", stepId: "previously-sent" } }] };
  const db = { from(table: string) {
    let rows = tables[table], payload: Row | undefined, operation = "read";
    const value = (row: Row, key: string) => key.includes("->>") ? (row[key.split("->>")[0]] as Row)?.[key.split("->>")[1]] : row[key];
    const query = {
      select() { return query; }, eq(key: string, expected: unknown) { rows = rows.filter(row => value(row, key) === expected); return query; },
      is(key: string, expected: unknown) { rows = rows.filter(row => row[key] === expected); return query; },
      update(input: Row) { operation = "update"; payload = input; return query; }, insert(input: Row) { operation = "insert"; payload = input; return query; },
      delete() { operation = "delete"; return query; }, maybeSingle() { return query; }, throwOnError() { return query; },
      then(resolve: (result: unknown) => unknown) {
        if (operation === "update") rows.forEach(row => Object.assign(row, payload));
        if (operation === "insert") tables[table].push(payload!);
        if (operation === "delete") tables[table] = tables[table].filter(row => !rows.includes(row));
        return Promise.resolve({ data: rows[0] ?? null }).then(resolve);
      },
    };
    return query;
  } };
  const deps: Record<string, unknown> = { "server-only": {}, "../auth.ts": { requireWorkspaceMember: async () => viewer }, "../supabase/admin.ts": { createSupabaseAdmin: () => db }, "../flow-recovery.ts": recovery };
  const exports: { recoverFlowRun?: (flowId: string, runId: string, action: string) => Promise<{ status: string }> } = {};
  const source = ts.transpileModule(readFileSync(new URL("../lib/data/flow-recovery.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (id: string) => deps[id], Date });
  return { recover: exports.recoverFlowRun!, run, tables };
}

test("recovery checks owner authorization and never replays an uncertain SMTP submission", async () => {
  const other = fixture({ id: "other", role: "bd_manager" });
  await assert.rejects(other.recover("flow", "run", "retry"), /owner or an administrator/);
  const app = fixture();
  app.run.context = { executionCheckpoint: { phase: "submitting", stepId: "current" } };
  await assert.rejects(app.recover("flow", "run", "retry"), /already have started/);
  assert.equal(app.run.status, "failed");
});

test("retry preserves the saved cursor and cancel preserves response claims for earlier sent actions", async () => {
  const app = fixture();
  assert.equal((await app.recover("flow", "run", "retry")).status, "queued");
  assert.equal(app.run.current_step, 3);
  assert.equal(app.run.status, "active");
  await app.recover("flow", "run", "cancel");
  assert.equal(app.run.status, "cancelled");
  assert.equal(app.tables.flow_run_logs.filter(log => (log.result as Row)?.action === "response_claimed").length, 1);
});
