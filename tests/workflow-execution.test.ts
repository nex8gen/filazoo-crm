import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../lib/ai-policy.ts";
import * as schemas from "../lib/ai/workflow-schema.ts";
import * as actions from "../lib/ai/agent-actions.ts";
import * as capabilities from "../lib/ai/capabilities.ts";
import * as intent from "../lib/ai/document-intent.ts";
import * as runner from "../lib/ai/workflow-runner.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";

type Row = Record<string, unknown>;
const owner = "a1111111-1111-4111-8111-111111111111";
const parent = "b2222222-2222-4222-8222-222222222222";
const savedCompany = "c3333333-3333-4333-8333-333333333333";
const savedTask = "d4444444-4444-4444-8444-444444444444";
const viewer = { id: owner, role: "admin" } as WorkspaceViewer;
const company = actions.preparedAgentActionSchema.parse({ type: "create_company", company: { name: "Synthetic", country: "US", segment: "Printing" } });
const task = (companyId: string) => actions.preparedAgentActionSchema.parse({ type: "crm_action", operation: { op: "create_task", companyId, title: "Follow up", priority: "normal" }, target: "Synthetic", fingerprint: "a".repeat(64), preview: {} });
const plan = schemas.workflowActionSchema.parse({ type: "run_workflow", steps: [
  { id: "customer", tool: "create_company", input: company },
  { id: "task", tool: "create_task", input: { title: "Follow up", priority: "normal" }, bindings: [{ path: ["companyId"], step: "customer", result: "companyId" }] },
] });

function fixture(mode: "auto" | "ask" = "auto") {
  const rows = new Map<string, Row>([[parent, { id: parent, user_id: owner, status: "running" }]]);
  const applied: Array<{ id: string; approval: string }> = [];
  const aiPolicy = policy.defaultAiPolicy();
  let roleChecks = 0;
  const db = { from(table: string) {
    assert.equal(table, "workspace_agent_actions");
    const filters: Array<[string, unknown]> = [];
    let mutation: Row | undefined, inserted: Row | undefined;
    const execute = () => {
      if (inserted) {
        if (rows.has(inserted.id as string)) return { error: { code: "23505" }, data: null };
        rows.set(inserted.id as string, { status: "pending", result: null, ...inserted });
        return { data: inserted, error: null };
      }
      const row = [...rows.values()].find(row => filters.every(([key, value]) => row[key] === value));
      if (row && mutation) Object.assign(row, mutation);
      return { data: row ?? null, error: null };
    };
    const q = { select() { return q; }, eq(key: string, value: unknown) { filters.push([key, value]); return q; },
      insert(value: Row) { inserted = value; return q; }, update(value: Row) { mutation = value; return q; },
      maybeSingle: async () => execute(), then(resolve: (result: unknown) => unknown) { return Promise.resolve(execute()).then(resolve); } };
    return q;
  } };
  const prepare = async (action: actions.PreparedAgentAction | Parameters<typeof actions.preparedAgentActionSchema.parse>[0]) => {
    const input = action as { type: string; operation?: { companyId?: string } };
    return { id: savedTask, action: input.type === "create_company" ? company : task(input.operation!.companyId!), approvalMode: input.type === "create_company" ? "ask" as const : mode, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../data/ai-settings": { getAiSettings: async () => ({ policy: aiPolicy }) },
    "../ai-policy": policy, "../supabase/admin": { createSupabaseAdmin: () => db },
    "./capabilities": capabilities, "./document-intent": intent, "./agent-actions": actions,
    "./workflow-schema": schemas, "./workflow-runner": runner,
    "./crm-execution": { authorizeCrmOperation: () => { roleChecks++; } },
    "@/app/api/ai/assistant/action/route": { POST: async (request: Request) => {
      const input = await request.json();
      const row = rows.get(input.id)!;
      assert.equal(row.user_id, owner); assert.equal(row.status, "pending");
      applied.push({ id: input.id, approval: input.approval });
      const action = row.action as { type: string; operation?: { companyId: string } };
      if (action.type === "crm_action") assert.equal(action.operation!.companyId, savedCompany);
      row.status = "completed";
      row.result = action.type === "create_company" ? { companyId: savedCompany, href: `/companies/${savedCompany}` } : { taskId: savedTask, href: "/tasks" };
      return Response.json(row.result);
    } },
  };
  const exports = {} as typeof import("../lib/ai/workflow-execution.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/ai/workflow-execution.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Request, Response, URL, Date, Error, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { exports, rows, applied, prepare, aiPolicy, roleChecks: () => roleChecks };
}

test("the server adapter prepares dependent work from actual saved IDs and reuses durable child receipts", async () => {
  const f = fixture();
  const prepared = await f.exports.prepareWorkflow(plan, viewer, { messages: [{ role: "user", content: "Create a company and a follow-up task for it." }] }, f.prepare);
  assert.equal(prepared.preparedSteps.length, 1); assert.equal(f.roleChecks(), 1);
  const run = () => f.exports.executeWorkflow(parent, prepared, viewer, new Request("http://localhost/api/ai/assistant/action"), f.prepare);
  const completed = await run();
  assert.equal(completed.workflow?.completed, 2);
  assert.deepEqual(f.applied.map(call => call.approval), ["manual", "auto"]);
  assert.equal((f.rows.get(parent)!.result as runner.WorkflowOutcome).workflow?.completed, 2);
  await run(); assert.equal(f.applied.length, 2);
});

test("dependent manual review survives server-adapter resume without replaying completed creation", async () => {
  const f = fixture("ask");
  const prepared = await f.exports.prepareWorkflow(plan, viewer, undefined, f.prepare);
  const run = () => f.exports.executeWorkflow(parent, prepared, viewer, new Request("http://localhost/api/ai/assistant/action"), f.prepare);
  const paused = await run();
  assert.equal(paused.workflow?.completed, 1); assert.equal(paused.awaitingAction?.approvalMode, "ask");
  assert.equal(f.applied.length, 1);
  const child = f.rows.get(paused.awaitingAction!.id)!;
  child.status = "completed"; child.result = { taskId: savedTask };
  assert.equal((await run()).workflow?.completed, 2);
  assert.equal(f.applied.length, 1);
});

test("a denied dependent tool fails preparation before any business action runs", async () => {
  const f = fixture(); f.aiPolicy.actions.tasks = "deny";
  await assert.rejects(f.exports.prepareWorkflow(plan, viewer, undefined, f.prepare), /blocked/);
  assert.equal(f.rows.size, 1); assert.equal(f.applied.length, 0);
});
