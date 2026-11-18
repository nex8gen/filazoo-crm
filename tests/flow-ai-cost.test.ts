import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { EmailPerformanceLog } from "../lib/flow-email-performance.ts";

const now = new Date("2026-11-18T00:00:00Z");
const usage = (id: string): EmailPerformanceLog => ({ id, run_id: id, created_at: "2026-11-17T00:00:00Z", result: { action: "ai_usage", generationId: `gen_${id}`, costUsd: null, stepId: "ai" } });
function fixture(failWrites = false) {
  const writes: Array<{ id: string; result: unknown; guards: unknown[] }> = [];
  const client = { from() { let result: unknown; let id = ""; const guards: unknown[] = []; const query = { update(value: { result: unknown }) { result = value.result; return query; }, eq(key: string, value: string) { guards.push([key, value]); if (key === "id") id = value; return query; }, async is(key: string, value: null) { guards.push([key, value]); writes.push({ id, result, guards }); return { error: failWrites ? { message: "Unavailable" } : null }; } }; return query; } };
  const output = {} as { reconcileFlowAiCosts: (client: unknown, logs: EmailPerformanceLog[], now: Date, fetcher: typeof fetch) => Promise<void> };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-ai-cost.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: output, require: (name: string) => name === "server-only" ? {} : name === "../ai/provider-credentials.ts" ? { resolveGatewayTokenAsync: async () => "synthetic-key" } : (() => { throw new Error(name); })(), process: { env: {} }, AbortSignal, fetch });
  return { client, writes, reconcile: output.reconcileFlowAiCosts };
}

test("confirmed billing is persisted with a race guard; pending, malformed and external billing never become invented zero totals", async () => {
  const app = fixture();
  const rows = [usage("known"), usage("pending"), usage("wrong"), usage("external"), usage("network")];
  await app.reconcile(app.client, rows, now, async input => {
    const id = new URL(String(input)).searchParams.get("id");
    if (id === "gen_pending") return Response.json({}, { status: 404 });
    if (id === "gen_network") throw new TypeError("Network unavailable");
    return Response.json({ data: { id: id === "gen_wrong" ? "gen_someoneelse" : id, total_cost: id === "gen_external" ? 0 : .0123, is_byok: id === "gen_external" } });
  });
  assert.equal(rows[0].result!.costUsd, .0123);
  for (const index of [1, 2, 4]) assert.equal(rows[index].result!.costUsd, null);
  assert.equal(rows[3].result!.costExternal, true);
  assert.equal(app.writes.length, 5);
  assert.ok(app.writes.every(write => write.guards.some(value => JSON.stringify(value) === '["result->>costUsd",null]')));
  let requests = 0;
  await app.reconcile(app.client, rows, now, async () => { requests++; throw new Error("Unexpected request"); });
  assert.equal(requests, 0, "Settled and recently pending charges are not queried again");
});

test("billing work is bounded and rotates pending generations without losing older charges", async () => {
  const app = fixture();const rows = Array.from({ length: 25 }, (_, i) => usage(String(i)));
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; return Response.json({}, { status: 404 }); };
  await app.reconcile(app.client, rows, now, fetcher);assert.equal(requests, 20);
  await app.reconcile(app.client, rows, new Date(now.getTime() + 60_000), fetcher);assert.equal(requests, 25);
  const expired = { ...usage("expired"), created_at: "2026-09-01T00:00:00Z" };
  await app.reconcile(app.client, [expired], now, fetcher);assert.equal(expired.result!.costLookupUnavailable, true);
  const before = requests;await app.reconcile(app.client, [expired], new Date(now.getTime() + 600_000), fetcher);assert.equal(requests, before);
});

test("a failed billing write does not falsely mark the report as reconciled", async () => {
  const app = fixture(true);const rows = [usage("writefailure")];
  await app.reconcile(app.client, rows, now, async () => Response.json({ data: { id: "gen_writefailure", total_cost: .1 } }));
  assert.equal(rows[0].result!.costUsd, null);
  assert.equal(rows[0].result!.costCheckedAt, undefined);
});
