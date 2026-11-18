import { policyTestDependency } from "./helpers/ai-policy.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as flowTree from "../lib/flow-tree.ts";
import * as flowMailboxes from "../lib/flow-mailboxes.ts";
import * as recovery from "../lib/flow-recovery.ts";
import vm from "node:vm";
import ts from "typescript";
import { flowInputSchema } from "../lib/flows.ts";
import * as flowModel from "../lib/flows.ts";
import * as flowAudit from "../lib/flow-audit.ts";
import * as segmentFlowModel from "../lib/segment-flows.ts";
import * as triggerEditor from "../lib/flow-trigger-editor.ts";
import { flowConnectorHealth } from "../lib/flow-connector-health.ts";
import * as flowEditorSession from "../lib/flow-editor-session.ts";
import * as flowAlertsModel from "../lib/flow-alerts.ts";
import * as flowEditorDraftModel from "../lib/flow-editor-draft.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

function loadModule(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => policyTestDependency(name) ?? (dependencies[name] ?? {}))(name), Response, Error, Date, URL, ...globals });
  return exports;
}

function fixture(role: string | null = "operator") {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    flows: ["alice", "bob"].map((owner, index) => ({
      id: `flow-${owner}`, user_id: owner, created_by: owner, name: `${owner}'s flow`,
      status: "draft", trigger_type: "new_lead", trigger_config: {},
      created_at: "2026-10-27T00:00:00Z", updated_at: `2026-10-27T0${index}:00:00Z`,
    })),
    flow_steps: ["alice", "bob"].map((owner) => ({ id: `step-${owner}`, flow_id: `flow-${owner}`, position: 0, type: "stop", config: {} })),
    flow_runs: [{ id: "run-bob", flow_id: "flow-bob", status: "active" }],
  };
  const calls: Array<{ table: string; operation: string; args: unknown[] }> = [];
  const validations: string[] = [];
  const senderChecks: Array<{ viewerId: string; ownerId: string }> = [];
  let senderDenied = false;
  let failure: string | null = null;
  const admin = {
    from(table: string) {
      let data = [...(rows[table] ?? [])];
      const record = (operation: string, args: unknown[]) => calls.push({ table, operation, args });
      const result = () => ({ data: data.slice(0, 1000), error: failure ? { message: failure } : null });
      const query = {
        select(...args: unknown[]) { record("select", args); return query; },
        order(...args: unknown[]) { record("order", args); return query; },
        limit(...args: unknown[]) { record("limit", args); return query; },
        range(from: number, to: number) { record("range", [from, to]); data = data.slice(from, to + 1); return query; },
        delete() { record("delete", []); return query; },
        eq(column: string, value: unknown) { record("eq", [column, value]); data = data.filter((row) => row[column] === value); return query; },
        in(column: string, values: unknown[]) { record("in", [column, values]); data = data.filter((row) => values.includes(row[column])); return query; },
        async maybeSingle() { return { ...result(), data: data[0] ?? null }; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      record("from", []);
      return query;
    },
    async rpc(name: string, input: { p_user_id: string; p_flow_id: string; p_input: flowModel.FlowInput }) {
      calls.push({ table: "rpc", operation: name, args: [input] });
      const flow = rows.flows.find((row) => row.id === input.p_flow_id && row.user_id === input.p_user_id);
      if (!flow) return { data: null, error: { message: "Workflow not found." } };
      Object.assign(flow, { name: input.p_input.name, status: input.p_input.status });
      return { data: flow.id, error: null };
    },
  };
  const auth = {
    async requireWorkspaceMember(allowed?: string[]) {
      if (!role || (allowed && !allowed.includes(role))) throw new Error("Access denied.");
      return { id: "alice", role };
    },
  };
  const dependencies = { "../auth.ts": auth, "../supabase/admin.ts": { createSupabaseAdmin: () => admin }, "../flows.ts": flowModel, "../flow-editor-draft.ts": flowEditorDraftModel };
  const flows = loadModule("../lib/data/flows.ts", { ...dependencies, "./flow-runtime.ts": {
    validateFlowSenderAccess: async (viewerId: string, _input: unknown, ownerId = viewerId) => {
      senderChecks.push({ viewerId, ownerId });
      if (senderDenied) throw new Error("Sender access denied.");
    },
    validateFlowResources: async (userId: string) => { validations.push(userId); },
  } });
  const runtime = loadModule("../lib/data/flow-runtime.ts", { ...dependencies, "../flow-recovery.ts": recovery });
  return { flows, runtime, calls, rows, auth, validations, senderChecks, denySender: () => { senderDenied = true; }, fail: (message: string) => { failure = message; } };
}

test("workflow sender authorization runs before create or update writes for every editor role", async () => {
  for (const role of ["admin", "operator", "bd_manager"]) {
    const f = fixture(role);
    f.denySender();
    await assert.rejects(f.flows.createFlow("alice", flowModel.defaultFlowInput), /Sender access denied/);
    await assert.rejects(f.flows.updateFlow("alice", "flow-alice", flowModel.defaultFlowInput), /Sender access denied/);
    assert.deepEqual(f.senderChecks, [{ viewerId: "alice", ownerId: "alice" }, { viewerId: "alice", ownerId: "alice" }]);
    assert.ok(!f.calls.some(call => call.table === "rpc"));
  }
  const admin = fixture("admin");
  admin.denySender();
  await assert.rejects(admin.flows.updateFlow("alice", "flow-bob", flowModel.defaultFlowInput), /Sender access denied/);
  assert.deepEqual(admin.senderChecks, [{ viewerId: "alice", ownerId: "bob" }]);
  assert.ok(!admin.calls.some(call => call.table === "rpc"));
});

test("every workspace role sees other creators' flows with their steps and run counts", async () => {
  for (const role of ["admin", "operator", "bd_manager", "viewer"]) {
    const f = fixture(role);
    const flows = await f.flows.listWorkspaceFlows() as Array<{ id: string; createdBy: string; activeRuns: number; steps: Array<{ id: string }> }>;
    assert.equal(flows.length, 2);
    const shared = flows.find((flow) => flow.id === "flow-bob")!;
    assert.equal(shared.createdBy, "bob");
    assert.equal(shared.steps[0].id, "step-bob");
    assert.equal(shared.activeRuns, 1);
    assert.ok(!f.calls.some((call) => call.table === "flows" && call.operation === "eq" && call.args[0] === "user_id"));
  }
});

test("email card status changes edit only the selected root or nested email and preserve workflow status", async () => {
  for (const nested of [false, true]) {
    const hooks = { values: [] as unknown[], cursor: 0 };
    const requests: flowModel.FlowInput[] = [];
    const render = builder(hooks, { fetch: async (_url: string, init: { body: string }) => {
      const payload = JSON.parse(init.body) as { flow: flowModel.FlowInput };
      requests.push(payload.flow);
      return Response.json({ ok: true, flow: { ...flow, ...payload.flow } });
    } });
    const target = { ...flowModel.blankStep("send_email"), id: "target-email", config: { ...flowModel.defaultFlowInput.steps[1].config, emailName: "Welcome", emailStatus: "live" } };
    const sibling = { ...target, id: "other-email", config: { ...target.config, emailName: "Follow up" } };
    const split = flowModel.blankStep("split");
    (split.config.paths as unknown as Array<{ steps: flowModel.FlowStep[] }>)[0].steps = [target];
    const flow = { ...flowModel.defaultFlowInput, id: "email-status-flow", createdBy: "alice", status: "live", updatedAt: "2026-11-17T00:00:00Z", steps: nested ? [split, sibling] : [target, sibling] };
    const props = { initialFlows: [flow], initialFlowId: flow.id, viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: {} };
    let tree = await render(props);
    const provider = elements(tree).find(node => node.type === "FlowEmailPerformanceProvider")!;
    (provider.props.onEmailStatusChange as (id: string, status: string) => void)(target.id, "draft");
    await new Promise<void>(resolve => setImmediate(resolve));
    hooks.cursor = 0; tree = await render(props);
    const canvas = elements(tree).find(node => typeof node.type === "function" && node.type.name === "FlowCanvas")!;
    const draft = canvas.props.draft as flowModel.FlowInput;
    assert.equal(draft.status, "live");
    const actions = flowTree.flowActionLocations(draft.steps);
    assert.equal(actions.find(item => item.action.id === target.id)!.action.config.emailStatus, "draft");
    assert.equal(actions.find(item => item.action.id === sibling.id)!.action.config.emailStatus, "live");
    assert.equal(actions.find(item => item.action.id === target.id)!.action.config.emailName, "Welcome");
    assert.equal(requests.length, 1, "Changing card status must be persisted immediately");
    assert.equal(requests[0].status, "live");
    assert.equal(flowTree.flowActionLocations(requests[0].steps).find(item => item.action.id === target.id)!.action.config.emailStatus, "draft");
  }
});

test("loading a saved editing copy restores incomplete actions without replacing the runnable definition", async () => {
  const f = fixture();
  const email = flowModel.blankStep("send_email");
  f.rows.flow_editor_drafts = [{ flow_id: "flow-alice", revision: 3, base_updated_at: "2026-10-27T00:00:00Z", payload: { ...flowModel.defaultFlowInput, steps: [email] } }];
  const flows = await f.flows.listWorkspaceFlows() as flowModel.AutomationFlow[];
  const saved = flows.find(flow => flow.id === "flow-alice")!;
  assert.equal(saved.steps[0].type, "stop");
  assert.equal(saved.editorDraft?.definition.steps[0].id, email.id);
  assert.equal(saved.editorDraft?.definition.steps[0].config.templateId, "");
  assert.equal(saved.editorDraft?.revision, 3);
});

test("shared reads reject nonmembers before issuing privileged queries", async () => {
  const f = fixture(null);
  await assert.rejects(f.flows.listWorkspaceFlows(), /Access denied/);
  await assert.rejects(f.runtime.listFlowRunInsights("flow-bob"), /Access denied/);
  assert.equal(f.calls.length, 0);
});

test("email and company flows appear in shared and owned lists and cannot be broadened on edit", async () => {
  for (const scope of ["email", "company"]) {
    const f = fixture();
    f.rows.flows[0].trigger_config = { flowScope: scope, scopeCompanyId: "company", ...(scope === "email" ? { scopeContactId: "contact" } : {}) };
    assert.equal((await f.flows.listWorkspaceFlows() as flowModel.AutomationFlow[]).length, 2);
    assert.equal((await f.flows.listFlows("alice") as flowModel.AutomationFlow[]).length, 1);
    await assert.rejects(f.flows.updateFlow("alice", "flow-alice", flowModel.defaultFlowInput), /must keep its original/);
    assert.equal(f.calls.filter((call) => call.operation === "save_automation_flow").length, 0);
  }
});

test("BD managers see scoped flows only for their currently assigned companies", async () => {
  const f = fixture("bd_manager");
  f.rows.flows[0].trigger_config = { flowScope: "email", scopeCompanyId: "assigned", scopeContactId: "contact-a" };
  f.rows.flows[1].trigger_config = { flowScope: "company", scopeCompanyId: "unassigned" };
  f.rows.pipeline = [{ company_id: "assigned", owner_id: "alice" }];
  assert.deepEqual((await f.flows.listWorkspaceFlows() as flowModel.AutomationFlow[]).map(flow => flow.id), ["flow-alice"]);
  f.rows.pipeline = [];
  assert.equal((await f.flows.listFlows("alice") as unknown[]).length, 0);
  await assert.rejects(f.flows.listFlows("bob"), /Access denied/);
  f.fail("assignment read unavailable");
  await assert.rejects(f.flows.listWorkspaceFlows(), /Unable to load workflows/);
});

test("owner-scoped reads remain isolated for legacy automation and save responses", async () => {
  const f = fixture();
  const flows = await f.flows.listFlows("alice") as Array<{ id: string }>;
  assert.equal(flows.length, 1);
  assert.equal(flows[0].id, "flow-alice");
  assert.ok(f.calls.some((call) => call.table === "flows" && call.operation === "eq" && call.args[0] === "user_id" && call.args[1] === "alice"));
});

test("non-admin editors cannot delete or update another creator's flow", async () => {
  for (const role of ["operator", "bd_manager"]) {
    const f = fixture(role);
    await assert.rejects(f.flows.deleteFlow("alice", "flow-bob"), /Workflow not found/);
    await assert.rejects(f.flows.updateFlow("alice", "flow-bob", { status: "live" }), /Workflow not found/);
    assert.ok(!f.calls.some((call) => call.table === "rpc"));
    assert.equal(f.validations.length, 0);
    assert.ok(f.calls.some((call) => call.operation === "eq" && call.args[0] === "user_id" && call.args[1] === "alice"));
  }
});

test("admins can edit and delete any flow while preserving its owner and runtime identity", async () => {
  const f = fixture("admin");
  const updated = await f.flows.updateFlow("alice", "flow-bob", { ...flowModel.defaultFlowInput, name: "Admin updated", status: "live" }) as flowModel.AutomationFlow;
  assert.equal(updated.id, "flow-bob");
  assert.equal(updated.name, "Admin updated");
  assert.equal(updated.status, "live");
  assert.equal(updated.createdBy, "bob");
  assert.equal(f.rows.flows[1].user_id, "bob");
  assert.deepEqual(f.validations, ["bob"]);
  const rpc = f.calls.find((call) => call.operation === "save_automation_flow")!;
  assert.equal((rpc.args[0] as { p_user_id: string }).p_user_id, "bob");
  f.calls.length = 0;
  await f.flows.deleteFlow("alice", "flow-bob");
  assert.ok(f.calls.some((call) => call.operation === "delete"));
  assert.ok(!f.calls.some((call) => call.operation === "eq" && call.args[0] === "user_id"));
});

test("owners can still edit and delete their own flows", async () => {
  const f = fixture("bd_manager");
  const updated = await f.flows.updateFlow("alice", "flow-alice", { ...flowModel.defaultFlowInput, name: "Owner updated" }) as flowModel.AutomationFlow;
  assert.equal(updated.name, "Owner updated");
  await f.flows.deleteFlow("alice", "flow-alice");
});

test("flow writes reject viewers, nonmembers and impersonated actor IDs before querying", async () => {
  for (const role of ["viewer", null]) {
    const f = fixture(role);
    await assert.rejects(f.flows.deleteFlow("alice", "flow-alice"), /Access denied/);
    await assert.rejects(f.flows.updateFlow("alice", "flow-alice", flowModel.defaultFlowInput), /Access denied/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture("admin");
  await assert.rejects(f.flows.deleteFlow("bob", "flow-bob"), /Access denied/);
  await assert.rejects(f.flows.updateFlow("bob", "flow-bob", flowModel.defaultFlowInput), /Access denied/);
  assert.equal(f.calls.length, 0);
});

test("flow mutation endpoints allow admin management of other users' flows and deny other editors", async () => {
  for (const role of ["admin", "operator", "bd_manager", "viewer", null]) {
    const f = fixture(role);
    const routes = loadModule("../app/api/flows/[id]/route.ts", { "@/lib/auth": f.auth, "@/lib/data/flows": f.flows, "@/lib/flows": { flowInputSchema } });
    const request = new Request("http://localhost/api/flows/flow-bob", { method: "PUT", body: JSON.stringify({ ...flowModel.defaultFlowInput, name: "Admin updated" }) });
    const context = { params: Promise.resolve({ id: "flow-bob" }) };
    if (!role || role === "viewer") {
      await assert.rejects(routes.PUT(request, context), /Access denied/);
      await assert.rejects(routes.DELETE(undefined, context), /Access denied/);
      continue;
    }
    const updated = await routes.PUT(request, context) as Response;
    const deleted = await routes.DELETE(undefined, context) as Response;
    assert.equal(updated.status, role === "admin" ? 200 : 404);
    assert.equal(deleted.status, role === "admin" ? 200 : 404);
    if (role === "admin") assert.equal((await updated.json()).flow.createdBy, "bob");
  }
});

test("bulk status changes use saved definitions, deduplicate IDs and preserve each owner's identity", async () => {
  const f = fixture("admin");
  const results = await f.flows.bulkUpdateFlows("alice", ["flow-alice", "flow-bob", "flow-bob"], "live") as flowModel.FlowBulkResult[];
  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.ok && result.flow?.status === "live"));
  assert.deepEqual(f.validations, ["alice", "bob"]);
  assert.equal(f.rows.flows[1].user_id, "bob");
  assert.equal(f.rows.flows[1].created_by, "bob");
  const saves = f.calls.filter((call) => call.operation === "save_automation_flow");
  assert.equal(saves.length, 2);
  assert.equal((saves[1].args[0] as { p_input: flowModel.FlowInput }).p_input.steps[0].type, "stop");
});

test("bulk actions report permission failures per flow and block read-only or impersonated actors", async () => {
  for (const action of ["live", "paused", "delete"]) {
    const f = fixture("operator");
    const results = await f.flows.bulkUpdateFlows("alice", ["flow-alice", "flow-bob", "missing"], action) as flowModel.FlowBulkResult[];
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.equal(results[2].ok, false);
    assert.equal(f.rows.flows[1].status, "draft");
  }
  for (const role of ["viewer", null]) {
    const f = fixture(role);
    await assert.rejects(f.flows.bulkUpdateFlows("alice", ["flow-bob"], "delete"), /Access denied/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture("admin");
  await assert.rejects(f.flows.bulkUpdateFlows("bob", ["flow-bob"], "delete"), /Access denied/);
  assert.equal(f.calls.length, 0);
});

test("a bulk activation reports invalid flows while continuing valid updates", async () => {
  const f = fixture("admin");
  f.rows.flow_steps[0].type = "send_email";
  const results = await f.flows.bulkUpdateFlows("alice", ["flow-alice", "flow-bob"], "live") as flowModel.FlowBulkResult[];
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, true);
  assert.equal(f.rows.flows[0].status, "draft");
  assert.equal(f.rows.flows[1].status, "live");
  assert.deepEqual(f.validations, ["bob"]);
});

test("bulk status updates preserve complete definitions when selections contain over 1000 steps", async () => {
  const f = fixture("admin");
  f.rows.flows = Array.from({ length: 21 }, (_, index) => ({ ...f.rows.flows[0], id: `flow-${index}`, user_id: "alice" }));
  f.rows.flow_steps = f.rows.flows.flatMap((flow) => Array.from({ length: 50 }, (_, position) => ({
    id: `${flow.id}-step-${position}`, flow_id: flow.id, position, type: "stop", config: {},
  })));
  const results = await f.flows.bulkUpdateFlows("alice", f.rows.flows.map((flow) => flow.id), "paused") as flowModel.FlowBulkResult[];
  assert.equal(results.length, 21);
  assert.ok(results.every((result) => result.ok));
  const saves = f.calls.filter((call) => call.operation === "save_automation_flow");
  assert.equal(saves.length, 21);
  assert.ok(saves.every((call) => (call.args[0] as { p_input: flowModel.FlowInput }).p_input.steps.length === 50));
  assert.ok(f.calls.some((call) => call.table === "flow_steps" && call.operation === "range" && call.args[0] === 1000));
});

test("bulk endpoint validates and bounds requests and returns explicit per-flow results", async () => {
  const ids = ["c0c0c0c0-1111-4111-8111-111111111111", "c0c0c0c0-2222-4222-8222-222222222222"];
  let executions = 0;
  const makeRoute = (role: string | null) => loadModule("../app/api/flows/bulk/route.ts", {
    "@/lib/auth": fixture(role).auth,
    "@/lib/flows": flowModel,
    "@/lib/data/flows": { bulkUpdateFlows: async (userId: string, requested: string[], action: string) => {
      executions++;
      assert.equal(userId, "alice");
      assert.equal(requested.length, 2);
      assert.equal(action, "paused");
      return [{ id: requested[0], ok: true }, { id: requested[1], ok: false, error: "Workflow not found." }];
    } },
  }).POST;
  const request = (body: unknown) => new Request("http://localhost/api/flows/bulk", { method: "POST", body: JSON.stringify(body) });
  const post = makeRoute("admin");
  for (const body of [{ ids: [], action: "delete" }, { ids: ["invalid"], action: "delete" }, { ids: Array(101).fill(ids[0]), action: "live" }, { ids, action: "invalid" }, null]) {
    assert.equal((await post(request(body)) as Response).status, 400);
  }
  assert.equal(executions, 0);
  for (const role of ["viewer", null]) await assert.rejects(makeRoute(role)(request({ ids, action: "paused" })), /Access denied/);
  const response = await post(request({ ids: [...ids, ids[0]], action: "paused" })) as Response;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[1].ok, false);
  assert.equal(executions, 1);
});

test("shared flow insights are accessible and remain scoped to the selected flow", async () => {
  const f = fixture("viewer");
  const runs = await f.runtime.listFlowRunInsights("flow-bob") as Array<{ id: string }>;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, "run-bob");
  assert.ok(f.calls.some((call) => call.table === "flow_runs" && call.operation === "eq" && call.args[0] === "flow_id" && call.args[1] === "flow-bob"));
  await assert.rejects(f.runtime.listFlowRunInsights("missing"), /Workflow not found/);
  f.fail("database unavailable");
  await assert.rejects(f.runtime.listFlowRunInsights("flow-bob"), /Unable to load workflow: database unavailable/);
});

test("shared listing handles empty workspaces and propagates database failures", async () => {
  const f = fixture();
  f.rows.flows = [];
  assert.equal((await f.flows.listWorkspaceFlows() as unknown[]).length, 0);
  f.fail("database unavailable");
  await assert.rejects(f.flows.listWorkspaceFlows(), /Unable to load workflows: database unavailable/);
});

test("flow listing and insights routes return shared data without caching and enforce membership", async () => {
  for (const role of ["admin", "operator", "bd_manager", "viewer", null]) {
    const f = fixture(role);
    const dependencies = { "@/lib/auth": f.auth, "@/lib/data/flows": f.flows, "@/lib/data/flow-runtime": f.runtime, "@/lib/flows": { flowInputSchema } };
    const list = loadModule("../app/api/flows/route.ts", dependencies).GET;
    const insights = loadModule("../app/api/flows/[id]/runs/route.ts", dependencies).GET;
    if (!role) {
      await assert.rejects(list(), /Access denied/);
      await assert.rejects(insights(undefined, { params: Promise.resolve({ id: "flow-bob" }) }), /Access denied/);
      assert.equal(f.calls.length, 0);
      continue;
    }
    const response = await list() as Response;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).flows.length, 2);
    const history = await insights(new Request("https://crm.test/api/flows/flow-bob/runs"), { params: Promise.resolve({ id: "flow-bob" }) }) as Response;
    assert.equal(history.status, 200);
    assert.equal(history.headers.get("cache-control"), "no-store");
    assert.equal((await history.json()).runs[0].id, "run-bob");
    const missing = await insights(new Request("https://crm.test/api/flows/missing/runs"), { params: Promise.resolve({ id: "missing" }) }) as Response;
    assert.equal(missing.status, 404);
    for (const query of ["?status=invalid", "?page=-1", "?page=1001", "?page=1.5"]) {
      assert.equal((await insights(new Request(`https://crm.test/api/flows/flow-bob/runs${query}`), { params: Promise.resolve({ id: "flow-bob" }) }) as Response).status, 400);
    }
  }
});

type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

function builder(hooks?: { values: unknown[]; cursor: number }, globals: Record<string, unknown> = {}) {
  // Inspect the actual component output and handlers with React/browser
  // boundaries isolated, so these tests need no session or email provider.
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props });
  function state(value: unknown): [unknown, (next: unknown) => void] {
    if (!hooks) return [typeof value === "function" ? value() : value, () => {}];
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof value === "function" ? value() : value;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next; }];
  }
  const dependencies = new Proxy({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    // Isolate deferred panels just like the previously eager component stubs.
    "next/dynamic": { default: (loader: () => unknown) => /module\.(\w+)/.exec(String(loader))?.[1] ?? "DeferredComponent" },
    react: {
      lazy: () => "LazyComponent", Suspense: "Suspense",
      useId: () => "test-workflow-alerts", useImperativeHandle: () => {},
      useState: state, useRef: (value: unknown) => state({ current: value })[0],
      useEffect: () => {}, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
    },
    "@dnd-kit/core": { ...components, useSensors: () => [], useSensor: () => ({}) },
    "@/lib/flows": flowModel,
    "@/lib/segment-flows": segmentFlowModel,
    "@/lib/flow-audit": flowAudit,
    "@/lib/flow-tree": flowTree,
    "@/lib/flow-editor-session": flowEditorSession,
    "@/lib/flow-alerts": flowAlertsModel,
    "@/lib/flow-mailboxes": flowMailboxes,
    "@/components/use-flow-connector-health": { useFlowConnectorHealth: (flow: flowModel.FlowInput | null) => flowConnectorHealth(flow) },
    sonner: { toast: { error: () => {}, success: () => {} } },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (text: string) => text }) },
  }, { get: (target, name) => Reflect.get(target, name) ?? components });
  return loadModule("../components/flow-builder.tsx", dependencies, globals).FlowBuilder;
}

test("only admins see workflow creators while mutation controls remain reserved for owners and admins", async () => {
  const initialFlows = ["alice", "bob"].map((createdBy) => ({
    ...flowModel.defaultFlowInput, id: `flow-${createdBy}`, name: "3-step follow-up", createdBy,
    updatedAt: "2026-10-27T00:00:00Z", steps: [], activeRuns: 0, completedRuns: 0,
  }));
  const render = builder();
  const tree = await render({ initialFlows, viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [{ id: "bob", label: "Bob", avatarUrl: "/bob-profile.webp" }], filterOptions: {} });
  const list = elements(tree).find((element) => typeof element.type === "function" && element.type.name === "FlowListView")!;
  const output = (list.type as (props: Element["props"]) => Element)(list.props);
  const actions = elements(output).filter((element) => typeof element.type === "function" && element.type.name === "FlowActions");
  assert.equal(actions.length, 2);
  assert.equal(actions[0].props.canEdit, true);
  assert.equal(actions[1].props.canEdit, false);
  assert.equal(actions[1].props.canDuplicate, true);
  const sharedMenu = (actions[1].type as (props: Element["props"]) => Element)(actions[1].props);
  const items = elements(sharedMenu).filter((element) => element.type === "DropdownMenuItem");
  assert.equal(items[0].props.children, "View");
  assert.equal(items[2].props.disabled, true);
  assert.equal(items[3].props.disabled, true);
  const headers = elements(output).filter((element) => element.type === "TableHead");
  assert.equal(headers.length, 8);
  assert.equal(headers[2].props.children, "Trigger");
  assert.ok(!headers.some(element => element.props.children === "Created by"));
  assert.equal(elements(output).filter(element => element.type === "UserAvatar").length, 0);
  const rows = elements(output).filter(element => element.type === "TableRow");
  assert.ok(rows.slice(1).every(row => elements(row).filter(element => element.type === "TableCell").length === 8));

  const adminTree = await render({ ...list.props, initialFlows, viewerId: "alice", isAdmin: true, canEdit: true, mailboxOptions: [], filterOptions: {} });
  const adminList = elements(adminTree).find((element) => typeof element.type === "function" && element.type.name === "FlowListView")!;
  const adminOutput = (adminList.type as (props: Element["props"]) => Element)(adminList.props);
  const adminHeaders = elements(adminOutput).filter(element => element.type === "TableHead");
  assert.equal(adminHeaders.length, 9);
  assert.equal(adminHeaders[2].props.children, "Created by");
  const cells = elements(adminOutput).filter(element => element.type === "TableCell");
  assert.ok(elements(cells[2]).some(element => element.type === "span" && element.props.children === "You"));
  assert.ok(elements(cells[11]).some(element => element.type === "span" && element.props.children === "Bob"));
  const avatars = elements(adminOutput).filter(element => element.type === "UserAvatar");
  assert.deepEqual(avatars.map(element => element.props.userId), ["alice", "bob"]);
  assert.equal(avatars[0].props.imageUrl, undefined);
  assert.equal(avatars[1].props.imageUrl, "/bob-profile.webp");
  const adminActions = elements(adminOutput).filter((element) => typeof element.type === "function" && element.type.name === "FlowActions");
  assert.ok(adminActions.every((element) => element.props.canEdit === true));
  const adminMenu = (adminActions[1].type as (props: Element["props"]) => Element)(adminActions[1].props);
  const adminItems = elements(adminMenu).filter((element) => element.type === "DropdownMenuItem");
  assert.equal(adminItems[0].props.children, "Edit");
  assert.equal(adminItems[3].props.disabled, false);
});

test("shared deep links open a read-only builder and the default shortcut selects the viewer's flow", async () => {
  const initialFlows = ["bob", "alice"].map((createdBy) => ({
    ...flowModel.defaultFlowInput, id: `flow-${createdBy}`, name: "3-step follow-up", createdBy,
  }));
  const render = builder();
  for (const [initialFlowId, canEdit, isAdmin, expectedDisabled] of [["flow-bob", true, false, true], ["flow-bob", true, true, false], ["default", true, false, false], ["flow-alice", false, false, true]] as const) {
    const tree = await render({ initialFlows, initialFlowId, viewerId: "alice", canEdit, isAdmin, mailboxOptions: [], memberOptions: [], filterOptions: {} });
    const nodes = elements(tree);
    const nameInput = nodes.find((element) => element.type === "Input" && element.props["aria-label"] === "Workflow name")!;
    assert.equal(nameInput.props.disabled, expectedDisabled);
    const saveButton = nodes.find((element) => element.type === "Button" && elements(element.props.children).some((child) => child.type === "Save"))!;
    assert.equal(saveButton.props.disabled, expectedDisabled);
    const canvas = nodes.find((element) => typeof element.type === "function" && element.type.name === "FlowCanvas")!;
    assert.equal(canvas.props.canEdit, !expectedDisabled);
    if (initialFlowId === "default") assert.equal((canvas.props.draft as { id: string }).id, "flow-alice");
  }
});

test("the reference editor switches one left panel between actions and selected node settings", async () => {
  const hooks = { values: [] as unknown[], cursor: 0 };
  const render = builder(hooks);
  const flow = { ...flowModel.defaultFlowInput, id: "editor-flow", createdBy: "alice", updatedAt: "2026-10-27T00:00:00Z" };
  const props = { initialFlows: [flow], initialFlowId: flow.id, viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: { segments: [], countries: [] } };
  const refresh = async () => { hooks.cursor = 0; return render(props); };
  let tree = await refresh();
  const component = (name: string) => elements(tree).find(node => typeof node.type === "function" && node.type.name === name);
  assert.ok(component("FlowActionPalette"));
  assert.ok(!elements(tree).some(node => node.props["aria-label"] === "Workflow settings"));
  const canvas = component("FlowCanvas")!;
  (canvas.props.setSelection as (id: string) => void)("trigger");
  tree = await refresh();
  assert.equal(component("FlowActionPalette"), undefined);
  const trigger = elements(tree).find(node => node.type === "FlowTriggerPanel")!;
  assert.ok(trigger);
  assert.equal(elements(tree).filter(node => node.type === "FlowTriggerPanel").length, 1);
  (trigger.props.onClose as () => void)();
  tree = await refresh();
  const palette = component("FlowActionPalette")!;
  assert.ok(palette);
  (palette.props.onClose as () => void)();
  tree = await refresh();
  assert.equal(component("FlowActionPalette"), undefined);
  assert.ok(elements(tree).some(node => node.props.className === "wf-show-actions"));
});

test("every root and branch action uses the same settings panel and respects read-only access", async () => {
  for (const nested of [false, true]) for (const canEdit of [true, false]) {
    const hooks = { values: [] as unknown[], cursor: 0 };
    const render = builder(hooks);
    const actions = flowModel.stepTypes.map((type, index) => ({ ...flowModel.blankStep(type), id: `action-${index}` }));
    const steps = nested ? [{ ...flowModel.blankStep("split"), id: "parent-split", config: { paths: [{ id: "matches", name: "Matches", condition: { field: "customer_replied" }, steps: actions }, { id: "other", name: "Everyone else", condition: null, steps: [] }] } }] : actions;
    const flow = { ...flowModel.defaultFlowInput, id: "all-actions", createdBy: "alice", updatedAt: "2026-10-27T00:00:00Z", steps };
    const props = { initialFlows: [flow], initialFlowId: flow.id, viewerId: "alice", canEdit, mailboxOptions: [], memberOptions: [], filterOptions: {} };
    let tree = await render(props);
    for (const action of actions) {
      const canvas = elements(tree).find(node => typeof node.type === "function" && node.type.name === "FlowCanvas")!;
      (canvas.props.setSelection as (id: string) => void)(action.id!);
      hooks.cursor = 0;
      tree = await render(props);
      if (action.type === "wait") {
        const wait = elements(tree).find(node => node.type === "FlowWaitPanel")!;
        assert.ok(wait);
        assert.equal(wait.props.disabled, !canEdit);
        assert.deepEqual(JSON.parse(JSON.stringify(wait.props.config)), action.config);
        assert.equal((wait.props.trail as string[]).length > 0, nested);
        continue;
      }
      if (action.type === "send_email") {
        const email = elements(tree).find(node => node.type === "FlowEmailPanel")!;
        assert.ok(email); assert.equal(email.props.disabled, !canEdit);
        assert.deepEqual(JSON.parse(JSON.stringify(email.props.config)), action.config);
        continue;
      }
      assert.equal(elements(tree).filter(node => node.props["aria-label"] === "Workflow settings").length, 1);
      const inspector = elements(tree).find(node => typeof node.type === "function" && node.type.name === "StepInspector")!;
      assert.equal(inspector.props.type, action.type);
      assert.equal(inspector.props.disabled, !canEdit);
      const fields = (inspector.type as (props: Element["props"]) => Element)(inspector.props);
      assert.equal(fields.props["data-action-kind"], action.type);
      assert.equal(button(tree, "Duplicate"), undefined);
      assert.equal(elements(tree).find(node => node.props["aria-label"] === "Remove selected action"), undefined);
      const controls = elements(tree).find(node => node.type === "FlowPanelSaveControls")!;
      assert.equal(controls.props.disabled, !canEdit);
      assert.equal(elements(tree).some(node => node.props["aria-label"] === "Action location"), nested);
    }
  }
});

function settingsHarness(nested = false, publish = false) {
  const hooks = { values: [] as unknown[], cursor: 0 };
  const wait = flowModel.blankStep("wait"), stop = flowModel.blankStep("stop");
  const split = flowModel.blankStep("split");
  if (nested) (split.config.paths as Array<{ steps: flowModel.FlowInput["steps"] }>)[0].steps = [stop];
  const flow = { ...structuredClone(flowModel.defaultFlowInput), id: "settings-flow", createdBy: "alice", updatedAt: "2026-11-17T00:00:00Z", steps: nested ? [wait, split] : [wait, stop] };
  const calls: flowModel.FlowInput[] = [];
  let failSave = false;
  let gate: Promise<void> | null = null;
  const render = builder(hooks, { fetch: async (url: string, init: { body: string }) => {
    const input = JSON.parse(init.body); calls.push(input.flow ?? input);
    if (gate) await gate;
    return failSave ? Response.json({ ok: false, error: "Connection interrupted. Try saving again." }, { status: 503 }) : Response.json({ ok: true, flow: url === "/api/flows/editor-draft" ? publish ? { ...flow, ...input.flow, steps: input.flow.steps.map((step: flowModel.FlowStep, index: number) => ({ ...step, id: `published-${calls.length}-${index}` })), updatedAt: "2026-11-17T01:00:00Z" } : { ...flow, editorDraft: { definition: input.flow, revision: input.revision + 1, baseUpdatedAt: flow.updatedAt } } : { ...flow, ...input, updatedAt: "2026-11-17T01:00:00Z" } });
  } });
  const props = { initialFlows: [flow], initialFlowId: flow.id, viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: { countries: [], segments: [] } };
  let tree: Element;
  const component = (name: string) => elements(tree).find(node => node.type === name || typeof node.type === "function" && node.type.name === name)!;
  const refresh = async () => { hooks.cursor = 0; tree = await render(props) as Element; return tree; };
  return {
    refresh, component, wait, stop, calls,
    fail(value: boolean) { failSave = value; },
    hold() { let release!: () => void; gate = new Promise<void>(resolve => { release = resolve; }); return () => { gate = null; release(); }; },
    get draft() { return component("FlowCanvas").props.draft as flowModel.FlowInput; },
    select(id: string) { (component("FlowCanvas").props.setSelection as (id: string) => void)(id); },
    close() { const close = elements(tree).find(node => node.props["aria-label"] === "Close workflow settings"); if (close) (close.props.onClick as () => void)(); else { const panel = ["FlowWaitPanel", "FlowEmailPanel"].map(component).find(Boolean)!; (panel.props.onClose as () => void)(); } },
    get dialog() { return elements(tree).find(node => node.type === "Dialog" && node.props.open === true && elements(node).some(child => child.type === "DialogTitle" && child.props.children === "Save changes?")); },
  };
}

test("the text-only editor saves its message through the workflow editing endpoint", async () => {
  const app = settingsHarness(); await app.refresh();
  (app.component("FlowCanvas").props.onAddStep as (type: string) => void)("send_email");
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  const email = app.component("FlowEmailPanel");
  const config = { ...email.props.config as flowModel.JsonConfig, templateId: "custom", contentMode: "text", templateName: "Text only email", subject: "Hello", body: "Hello {{first_name}}", preheader: "A personal note" };
  assert.equal(await (email.props.onSaveText as (value: flowModel.JsonConfig) => Promise<boolean>)(config), true);
  await app.refresh();
  const saved = flowTree.flowActionLocations(app.calls.at(-1)!.steps).find(item => item.action.type === "send_email")!.action;
  assert.equal(saved.config.contentMode, "text"); assert.equal(saved.config.body, "Hello {{first_name}}");
  assert.equal(app.component("FlowEmailPanel").props.config && (app.component("FlowEmailPanel").props.config as flowModel.JsonConfig).preheader, "A personal note");
});

test("explicit Close retains Keep editing and Discard controls for configuration edits", async () => {
  for (const nested of [false, true]) {
    const app = settingsHarness(nested);
    await app.refresh(); app.select(app.stop.id!); await app.refresh();
    const inspector = app.component("StepInspector");
    (inspector.props.onChange as (config: flowModel.JsonConfig) => void)({ ...app.stop.config, reason: "Unsaved reason" });
    await app.refresh(); app.close(); await app.refresh();
    assert.ok(app.dialog);
    assert.equal(app.component("StepInspector").props.type, "stop");
    (button(app.dialog!, "Keep editing").props.onClick as () => void)();
    await app.refresh();
    assert.equal(app.dialog, undefined);
    assert.equal(flowTree.flowActionLocations(app.draft.steps).find(item => item.action.id === app.stop.id)!.action.config.reason, "Unsaved reason");
    app.close(); await app.refresh();
    (button(app.dialog!, "Discard changes").props.onClick as () => void)();
    await app.refresh();
    assert.equal(app.dialog, undefined);
    assert.equal(app.component("StepInspector"), undefined);
    assert.equal(flowTree.flowActionLocations(app.draft.steps).find(item => item.action.id === app.stop.id)!.action.config.reason, app.stop.config.reason);
    assert.equal(app.calls.length, 0);
  }
});

test("Save changes persists the selected action before continuing and retains edits on failure", async () => {
  const app = settingsHarness(true);
  await app.refresh(); app.select(app.stop.id!); await app.refresh();
  (app.component("StepInspector").props.onChange as (config: flowModel.JsonConfig) => void)({ ...app.stop.config, reason: "Saved nested reason" });
  await app.refresh(); app.close(); await app.refresh();
  app.fail(true);
  await (button(app.dialog!, "Save changes").props.onClick as () => Promise<void>)();
  // The UI handler deliberately returns void; allow its mocked request and response to settle.
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.ok(app.dialog, "a failed save must not navigate or discard the form");
  assert.equal(app.component("StepInspector").props.type, "stop");
  assert.ok(JSON.stringify(app.dialog).includes("Connection interrupted"));
  app.fail(false);
  (button(app.dialog!, "Save changes").props.onClick as () => void)();
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(app.dialog, undefined);
  assert.equal(app.component("StepInspector"), undefined);
  assert.equal(app.calls.length, 2);
  assert.equal(flowTree.flowActionLocations(app.calls[1].steps).find(item => item.action.id === app.stop.id)!.action.config.reason, "Saved nested reason");
});

test("pending delay fields participate in both Close and top-level Save before reaching the workflow", async () => {
  const app = settingsHarness();
  await app.refresh(); app.select(app.wait.id!); await app.refresh();
  const wait = app.component("FlowWaitPanel");
  const editor = wait.props.editorRef as { current: flowEditorSession.FlowPanelEditor | null };
  editor.current = { hasChanges: () => true, prepare: () => ({ ok: true, config: { ...app.wait.config, amount: 8 } }), reset() {} };
  (wait.props.onDirtyChange as (dirty: boolean) => void)(true);
  await app.refresh();
  assert.equal(app.draft.steps[0].config.amount, 1);
  const footer = elements(app.component("FlowWaitPanel").props.footer).find(node => node.type === "FlowPanelSaveControls")!;
  (footer.props.onCancel as () => void)(); await app.refresh();
  assert.ok(app.dialog);
  (button(app.dialog!, "Keep editing").props.onClick as () => void)(); await app.refresh();
  const tree = await app.refresh();
  const save = elements(tree).find(node => node.props["aria-label"] === "Save workflow")!;
  (save.props.onClick as () => void)();
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].steps[0].config.amount, 8);
});

test("new action placement saves automatically and switching away never asks for a separate save", async () => {
  const app = settingsHarness(); await app.refresh();
  (app.component("FlowCanvas").props.onAddStep as (type: string) => void)("send_email");
  await app.refresh();
  const inserted = app.draft.steps.at(-1)!;
  assert.equal(inserted.type, "send_email");
  app.select(app.wait.id!); await app.refresh();
  assert.equal(app.dialog, undefined);
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].steps.at(-1)!.id, inserted.id);
  assert.equal(app.draft.steps.at(-1)!.id, inserted.id);
  assert.equal(app.component("FlowAlertsBell").props.count, 1, "incomplete settings stay in Alerts after autosave");
});

test("switching actions automatically saves nested configuration changes without a prompt", async () => {
  const app = settingsHarness(true); await app.refresh(); app.select(app.stop.id!); await app.refresh();
  (app.component("StepInspector").props.onChange as (config: flowModel.JsonConfig) => void)({ ...app.stop.config, reason: "Automatically saved" });
  await app.refresh(); app.select(app.wait.id!); await app.refresh();
  assert.equal(app.dialog, undefined); assert.ok(app.component("FlowWaitPanel"));
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(flowTree.flowActionLocations(app.calls[0].steps).find(item => item.action.id === app.stop.id)!.action.config.reason, "Automatically saved");
});

test("switching preserves unfinished local fields without treating them as runnable settings", async () => {
  const app = settingsHarness(); await app.refresh(); app.select(app.wait.id!); await app.refresh();
  const editor = app.component("FlowWaitPanel").props.editorRef as { current: flowEditorSession.FlowPanelEditor | null };
  editor.current = { hasChanges: () => true, snapshot: () => ({ config: { ...app.wait.config, amount: "" } }), prepare: () => ({ ok: false }), reset() {} };
  app.select(app.stop.id!); await app.refresh();
  assert.equal(app.dialog, undefined); assert.equal(app.draft.steps[0].config.amount, "");
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(app.calls[0].steps[0].config.amount, "");
});

test("rapid action additions are queued without dropping or duplicating previous actions", async () => {
  const app = settingsHarness(); await app.refresh();
  (app.component("FlowCanvas").props.onAddStep as (type: string) => void)("send_email"); await app.refresh();
  (app.component("FlowCanvas").props.onAddStep as (type: string) => void)("wait"); await app.refresh();
  assert.equal(app.dialog, undefined);
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[0].steps.length, 3);
  assert.equal(app.calls[1].steps.length, 4);
  assert.equal(new Set(app.draft.steps.map(step => step.id)).size, 4);
});

test("an insertion response cannot overwrite settings edited while that request was pending", async () => {
  const app = settingsHarness(); const release = app.hold(); await app.refresh();
  (app.component("FlowCanvas").props.onAddStep as (type: string) => void)("send_email"); await app.refresh();
  await new Promise(resolve => setImmediate(resolve));
  const inserted = app.draft.steps.at(-1)!;
  (app.component("FlowEmailPanel").props.onChange as (config: flowModel.JsonConfig) => void)({ ...inserted.config, subject: "Keep this later edit" });
  await app.refresh(); app.select(app.wait.id!); await app.refresh();
  release(); await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(app.dialog, undefined);
  assert.equal(app.draft.steps.at(-1)!.config.subject, "Keep this later edit");
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1].steps.at(-1)!.config.subject, "Keep this later edit");
});

test("automatic publication keeps the selected settings panel open when database action IDs change", async () => {
  const app = settingsHarness(false, true); await app.refresh();
  (app.component("FlowCanvas").props.onAddStep as (type: string) => void)("wait"); await app.refresh();
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(app.component("FlowCanvas").props.selection, app.draft.steps.at(-1)!.id);
  assert.ok(app.component("FlowWaitPanel"));
  assert.equal(app.component("FlowWaitPanel").props.config.amount, 1);
  app.select(app.draft.steps[1].id!); await app.refresh();
  assert.equal(app.dialog, undefined); assert.equal(app.component("StepInspector").props.type, "stop");
});

test("failed autosaves retain inserted actions and expose a retry instead of a save/discard popup", async () => {
  const app = settingsHarness(); app.fail(true); await app.refresh();
  (app.component("FlowCanvas").props.onAddStep as (type: string) => void)("send_email"); await app.refresh();
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(app.draft.steps.length, 3);
  assert.equal(app.dialog, undefined);
  const email = app.component("FlowEmailPanel");
  const retry = elements(email.props.footer).find(node => node.type === "button" && node.props.children === "Retry")!;
  assert.ok(retry); app.fail(false);
  (retry.props.onClick as () => void)();
  await new Promise(resolve => setImmediate(resolve)); await app.refresh();
  assert.equal(app.calls.length, 2);
  assert.equal(app.draft.steps.length, 3);
});

test("the toolbar bell opens current-workflow setup alerts, respects unsaved edits, and scopes dismissals", async () => {
  const hooks = { values: [] as unknown[], cursor: 0 };
  const render = builder(hooks);
  const email = flowModel.blankStep("send_email"), task = flowModel.blankStep("create_task"), split = flowModel.blankStep("split");
  task.config.title = "";
  (split.config.paths as Array<{ steps: flowModel.FlowInput["steps"] }>)[0].steps = [task];
  const flow = { ...structuredClone(flowModel.defaultFlowInput), id: "alerts-one", name: "First workflow", createdBy: "alice", steps: [email, split] };
  const other = { ...flow, id: "alerts-two", name: "Other workflow" };
  const props = { initialFlows: [flow, other], initialFlowId: flow.id, viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: { countries: [], segments: [] } };
  let tree: Element;
  const refresh = async () => { hooks.cursor = 0; tree = await render(props) as Element; };
  const component = (name: string) => elements(tree).find(node => node.type === name || typeof node.type === "function" && node.type.name === name)!;
  const active = () => component("FlowAlertsPanel").props.active as flowAlertsModel.FlowAlert[];
  await refresh();
  assert.equal(component("FlowActivityBell"), undefined);
  assert.equal(component("FlowHealthNotice"), undefined);
  assert.equal(component("FlowAlertsBell").props.count, 2);
  (component("FlowAlertsBell").props.onToggle as () => void)(); await refresh();
  const review = () => component("FlowAlertsPanel").props.onReview as (alert: flowAlertsModel.FlowAlert) => void;
  review()(active().find(alert => alert.actionId === email.id)!); await refresh();
  assert.ok(component("FlowEmailPanel"));
  (component("FlowEmailPanel").props.onChange as (config: flowModel.JsonConfig) => void)({ ...email.config, templateId: "helpful_reminder" });
  await refresh();
  assert.equal(component("FlowAlertsBell").props.count, 1);
  review()(active().find(alert => alert.actionId === task.id)!); await refresh();
  const confirm = elements(tree).find(node => node.type === "Dialog" && node.props.open === true)!;
  assert.ok(confirm, "reviewing another action must preserve the save/discard guard");
  assert.ok(component("FlowEmailPanel"));
  (button(confirm, "Discard changes").props.onClick as () => void)(); await refresh();
  assert.equal(component("StepInspector").props.type, "create_task");
  assert.equal(component("FlowAlertsBell").props.count, 2);
  const alert = active().find(alert => alert.actionId === email.id)!;
  (component("FlowAlertsPanel").props.onDismiss as (alert: flowAlertsModel.FlowAlert) => void)(alert); await refresh();
  assert.equal(component("FlowAlertsBell").props.count, 1);
  assert.equal((component("FlowAlertsPanel").props.dismissed as unknown[]).length, 1);
  const otherItem = elements(tree).find(node => node.type === "DropdownMenuItem" && elements(node).some(child => child.type === "span" && child.props.children === other.name))!;
  (otherItem.props.onClick as () => void)(); await refresh();
  assert.equal(component("FlowAlertsBell").props.count, 2, "another workflow cannot inherit the first workflow's dismissal");
  assert.equal((component("FlowAlertsPanel").props.dismissed as unknown[]).length, 0);
});

test("turning on a draft first opens review while viewers cannot launch it", async () => {
  for (const canEdit of [true, false]) {
    const hooks = { values: [] as unknown[], cursor: 0 };
    const render = builder(hooks);
    const flow = { ...flowModel.defaultFlowInput, id: "review-flow", createdBy: "alice", updatedAt: "2026-10-27T00:00:00Z" };
    const props = { initialFlows: [flow], initialFlowId: flow.id, viewerId: "alice", canEdit, mailboxOptions: [], memberOptions: [], filterOptions: {} };
    let tree = await render(props);
    const review = button(tree, "Review and turn on");
    assert.equal(review.props.disabled, !canEdit);
    if (!canEdit) continue;
    const dialogs = () => elements(tree).filter(node => node.type === "Dialog");
    assert.ok(dialogs().every(node => node.props.open === false));
    (review.props.onClick as () => void)();
    hooks.cursor = 0;
    tree = await render(props);
    assert.equal(dialogs().filter(node => node.props.open === true).length, 1);
    const reviewDialog = dialogs().find(node => node.props.open === true)!;
    assert.ok(JSON.stringify(reviewDialog).includes("Review and turn on"));
    const canvas = elements(tree).find(node => typeof node.type === "function" && node.type.name === "FlowCanvas")!;
    assert.equal((canvas.props.draft as flowModel.FlowInput).status, "draft");
  }
});

test("analytics create shortcut opens the workflow starter only for editors", async () => {
  for (const canEdit of [true, false]) {
    const tree = await builder()({ initialFlows: [], initialCreate: true, viewerId: "alice", canEdit, mailboxOptions: [], memberOptions: [], filterOptions: {} });
    assert.equal(elements(tree).some(node => node.type === "LazyComponent"), canEdit);
    const list = elements(tree).find(node => typeof node.type === "function" && node.type.name === "FlowListView")!;
    const output = (list.type as (props: Element["props"]) => Element)(list.props);
    assert.ok(elements(output).some(node => node.type === "FlowViewToggle" && node.props.active === "list"));
  }
});

test("launch review blocks email workflows on a test-mode server before a save request", async () => {
  for (const liveSendingEnabled of [false, true]) {
    const hooks = { values: [] as unknown[], cursor: 0 };
    const render = builder(hooks);
    const flow = { ...flowModel.defaultFlowInput, id: "sending-mode", createdBy: "alice", updatedAt: "2026-11-17T00:00:00Z" };
    const props = { initialFlows: [flow], initialFlowId: flow.id, viewerId: "alice", canEdit: true, liveSendingEnabled, mailboxOptions: [], memberOptions: [], filterOptions: {} };
    let tree = await render(props);
    (button(tree, "Review and turn on").props.onClick as () => void)();
    hooks.cursor = 0;
    tree = await render(props);
    const dialog = elements(tree).find(node => node.type === "Dialog" && node.props.open === true)!;
    assert.equal(button(dialog, "Turn on workflow").props.disabled, !liveSendingEnabled);
    assert.equal(JSON.stringify(dialog).includes("Email delivery is temporarily unavailable"), !liveSendingEnabled);
  }
});

test("launching from any segment shows its fixed audience without customer or trigger selectors", async () => {
  for (const kind of ["saved", "business"]) {
    const initialDraft = segmentFlowModel.createSegmentFlowDraft({ id: "11111111-1111-4111-8111-111111111111", name: "Historical email lead", kind });
    const tree = await builder()({ initialFlows: [], initialDraft, viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: { segments: ["Historical email lead"], countries: ["US"] } });
    const inspector = elements(tree).find(node => node.type === "FlowTriggerPanel")!;
    assert.ok(inspector);
    assert.deepEqual((inspector.props.flow as flowModel.FlowInput).triggerConfig, initialDraft.triggerConfig);
    assert.equal((inspector.props.flow as flowModel.FlowInput).triggerType, "company_segment_changed");
    assert.equal(inspector.props.disabled, false);
  }
});

test("email builder prefills the scoped trigger and changing events retains its fixed recipient", async () => {
  const scope = { flowScope: "email", scopeCompanyId: "11111111-1111-4111-8111-111111111111", scopeContactId: "22222222-2222-4222-8222-222222222222", scopeLabel: "customer@example.com" };
  const hooks = { values: [] as unknown[], cursor: 0 };
  const render = builder(hooks);
  const props = { initialFlows: [], viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: { segments: [], countries: [] }, initialDraft: { ...flowModel.defaultFlowInput, triggerType: "email_received", triggerConfig: scope }, scopedContext: { config: scope, refreshUrl: "/api/email/flows?recipient=customer@example.com", returnHref: "/email?thread=test" } };
  const tree = await render(props);
  const inspector = elements(tree).find(node => node.type === "FlowTriggerPanel")!;
  const current = inspector.props.flow as flowModel.FlowInput;
  const change = triggerEditor.applyTriggerEvent(current, "no_reply", triggerEditor.triggerEventDraft(current, "no_reply"));
  (inspector.props.onChange as (flow: flowModel.FlowInput) => void)({ ...current, ...change });
  hooks.cursor = 0;
  const updated = await render(props);
  const canvas = elements(updated).find((node) => typeof node.type === "function" && node.type.name === "FlowCanvas")!;
  const draft = canvas.props.draft as flowModel.FlowInput;
  assert.equal(draft.triggerType, "no_reply");
  assert.equal(draft.triggerConfig.scopeContactId, scope.scopeContactId);
  assert.equal(draft.triggerConfig.scopeCompanyId, scope.scopeCompanyId);
});

test("workflow list combines workspace and email workflows for pagination and bulk actions", async () => {
  const hooks = { values: [] as unknown[], cursor: 0 };
  const initialFlows = [
    { id: "segment", triggerConfig: { segment: "Wholesale" }, activeRuns: 7 },
    { id: "contact", triggerConfig: { flowScope: "email", scopeContactId: "contact-a", scopeCompanyId: "company-a" }, activeRuns: 2 },
    { id: "company", triggerConfig: { flowScope: "company", scopeCompanyId: "company-b" }, activeRuns: 3 },
  ].map(flow => ({ ...flowModel.defaultFlowInput, createdBy: "alice", updatedAt: "2026-10-27T00:00:00Z", steps: [], status: "live", ...flow }));
  const tree = await builder(hooks)({ initialFlows, viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: {} });
  const list = elements(tree).find(node => typeof node.type === "function" && node.type.name === "FlowListView")!;
  const calls: unknown[] = [];
  const props = { ...list.props, onBulkAction: async (ids: string[], action: string) => { calls.push({ ids, action }); return ids.map(id => ({ id, ok: true })); } };
  hooks.values = [];
  const render = () => { hooks.cursor = 0; return (list.type as (props: Element["props"]) => Element)(props); };
  const ids = (output: Element) => elements(output).filter(node => typeof node.type === "function" && node.type.name === "FlowActions").map(node => (node.props.flow as { id: string }).id);
  let output = render();
  assert.deepEqual(Array.from(ids(output)), ["segment", "contact", "company"]);
  assert.equal(elements(output).some(node => node.type === "Tabs" || node.type === "TabsTrigger"), false);
  assert.equal(elements(output).find(node => node.type === "TablePagination")!.props.total, 3);
  assert.equal(elements(output).some(node => typeof node.type === "function" && node.type.name === "FlowSummary"), false);
  (checkboxes(output)[0].props.onCheckedChange as (checked: boolean) => void)(true);
  output = render();
  assert.equal(selectionCount(output), "3 selected");
  await (button(render(), "Pause").props.onClick as () => Promise<void>)();
  assert.equal(JSON.stringify(calls), JSON.stringify([{ ids: ["segment", "contact", "company"], action: "paused" }]));
  const scoped = (list.type as (props: Element["props"]) => Element)({ ...props, flows: [initialFlows[1]] });
  assert.equal(elements(scoped).some(node => node.type === "TabsTrigger"), false);
  assert.deepEqual(Array.from(ids(scoped)), ["contact"]);
});

test("an email workflow deep link returns to the combined workflow list", async () => {
  const hooks = { values: [] as unknown[], cursor: 0 };
  const render = builder(hooks);
  const props = { initialFlows: [{ ...flowModel.defaultFlowInput, id: "email-flow", createdBy: "alice", updatedAt: "2026-10-27T00:00:00Z", triggerConfig: { flowScope: "email", scopeContactId: "contact-a", scopeCompanyId: "company-a" } }], initialFlowId: "email-flow", viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: {} };
  const tree = await render(props);
  const back = elements(tree).find(node => node.type === "Button" && node.props["aria-label"] === "Back to workflows")!;
  (back.props.onClick as () => void)();
  hooks.cursor = 0;
  const list = elements(await render(props)).find(node => typeof node.type === "function" && node.type.name === "FlowListView")!;
  assert.equal(list.props.flows, props.initialFlows);
  const output = (list.type as (props: Element["props"]) => Element)(list.props);
  assert.equal(elements(output).some(node => node.type === "Tabs"), false);
  assert.equal(elements(output).filter(node => typeof node.type === "function" && node.type.name === "FlowActions").length, 1);
});

async function flowListHarness(count: number, isAdmin = true, canEdit = true, onBulkAction: (ids: string[], action: flowModel.FlowBulkAction) => Promise<flowModel.FlowBulkResult[]> = async (ids) => ids.map((id) => ({ id, ok: true }))) {
  const hooks = { values: [] as unknown[], cursor: 0 };
  const initialFlows = Array.from({ length: count }, (_, index) => ({
    ...flowModel.defaultFlowInput, id: `flow-${index}`, name: `Flow ${index}`,
    createdBy: index % 2 === 0 ? "alice" : "bob", updatedAt: "2026-10-27T00:00:00Z", steps: [],
  }));
  const tree = await builder(hooks)({ initialFlows, viewerId: "alice", isAdmin, canEdit, mailboxOptions: [], memberOptions: [], filterOptions: {} });
  const list = elements(tree).find((element) => typeof element.type === "function" && element.type.name === "FlowListView")!;
  const props: Element["props"] = { ...list.props, onBulkAction };
  hooks.values = [];
  const render = () => { hooks.cursor = 0; return (list.type as (props: Element["props"]) => Element)(props); };
  return { render, initialFlows };
}

const checkboxes = (tree: Element) => elements(tree).filter((element) => element.type === "Checkbox");
const selectionCount = (tree: Element) => elements(tree).find((element) => element.type === "span" && typeof element.props.children === "string" && /^\d+ selected$/.test(element.props.children))?.props.children;
function button(tree: Element, label: string) {
  return elements(tree).find((element) => element.type === "Button" && (element.props.children === label || (Array.isArray(element.props.children) && element.props.children.includes(label))))!;
}

test("flow selection persists across pages and page selection only changes that page", async () => {
  const list = await flowListHarness(30);
  let tree = list.render();
  (checkboxes(tree)[0].props.onCheckedChange as (checked: boolean) => void)(true);
  tree = list.render();
  assert.equal(selectionCount(tree), "25 selected");
  assert.equal(checkboxes(tree)[0].props.checked, true);
  (elements(tree).find((element) => element.type === "TablePagination")!.props.onNext as () => void)();
  tree = list.render();
  assert.equal(selectionCount(tree), "25 selected");
  assert.equal(checkboxes(tree)[0].props.checked, false);
  (checkboxes(tree)[1].props.onCheckedChange as (checked: boolean) => void)(true);
  tree = list.render();
  assert.equal(selectionCount(tree), "26 selected");
  assert.equal(checkboxes(tree)[0].props.indeterminate, true);
  (checkboxes(tree)[0].props.onCheckedChange as (checked: boolean) => void)(true);
  tree = list.render();
  assert.equal(selectionCount(tree), "30 selected");
  (elements(tree).find((element) => element.type === "TablePagination")!.props.onPrevious as () => void)();
  tree = list.render();
  (checkboxes(tree)[0].props.onCheckedChange as (checked: boolean) => void)(false);
  tree = list.render();
  assert.equal(selectionCount(tree), "5 selected");
  (button(tree, "Clear selection").props.onClick as () => void)();
  tree = list.render();
  assert.equal(selectionCount(tree), undefined);
  let stopped = false;
  const cell = elements(tree).find((element) => element.type === "TableCell")!;
  (cell.props.onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
});

test("workflow filters reset pagination while preserving selected rows outside the filtered view", async () => {
  const list = await flowListHarness(30);
  let tree = list.render();
  (elements(tree).find(element => element.type === "TablePagination")!.props.onNext as () => void)();
  tree = list.render();
  (checkboxes(tree)[0].props.onCheckedChange as (checked: boolean) => void)(true);
  tree = list.render();
  const search = elements(tree).find(element => element.type === "Input" && element.props.type === "search")!;
  (search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Flow 0" } });
  tree = list.render();
  let pagination = elements(tree).find(element => element.type === "TablePagination")!;
  assert.equal(pagination.props.page, 1);
  assert.equal(pagination.props.total, 1);
  assert.equal(selectionCount(tree), "5 selected");
  assert.equal(checkboxes(tree)[1].props.checked, false);
  const status = elements(tree).find(element => element.type === "Select")!;
  (status.props.onValueChange as (value: string) => void)("live");
  tree = list.render();
  pagination = elements(tree).find(element => element.type === "TablePagination")!;
  assert.equal(pagination.props.total, 0);
  assert.ok(elements(tree).some(element => element.type === "EmptyState" && element.props.title === "No matching workflows"));
  (button(tree, "Clear filters").props.onClick as () => void)();
  tree = list.render();
  assert.equal(elements(tree).find(element => element.type === "TablePagination")!.props.total, 30);
  assert.equal(selectionCount(tree), "5 selected");
});

test("the combined workflow list finds a recipient even when the flow name has no email", async () => {
  const list = await flowListHarness(2);
  list.initialFlows[0].triggerConfig = { flowScope: "email", scopeCompanyId: "company", scopeContactId: "contact", scopeLabel: "buyer@example.com" };
  const search = elements(list.render()).find(element => element.type === "Input" && element.props.type === "search")!;
  (search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "BUYER@example.com" } });
  const tree = list.render();
  const pagination = elements(tree).find(element => element.type === "TablePagination")!;
  assert.equal(pagination.props.total, 1);
  assert.ok(JSON.stringify(tree).includes("buyer@example.com"));
});

test("non-admin selection excludes other creators and viewers cannot select flows", async () => {
  const owner = await flowListHarness(2, false);
  let tree = owner.render();
  assert.equal(checkboxes(tree)[1].props.disabled, false);
  assert.equal(checkboxes(tree)[2].props.disabled, true);
  (checkboxes(tree)[0].props.onCheckedChange as (checked: boolean) => void)(true);
  tree = owner.render();
  assert.equal(selectionCount(tree), "1 selected");
  const viewer = await flowListHarness(2, false, false);
  assert.ok(checkboxes(viewer.render()).every((element) => element.props.disabled === true));
});

test("selection is limited to the bulk endpoint's maximum batch size", async () => {
  const list = await flowListHarness(101);
  let tree = list.render();
  for (let page = 0; page < 4; page++) {
    (checkboxes(tree)[0].props.onCheckedChange as (checked: boolean) => void)(true);
    tree = list.render();
    (elements(tree).find((element) => element.type === "TablePagination")!.props.onNext as () => void)();
    tree = list.render();
  }
  assert.equal(selectionCount(tree), "100 selected");
  (checkboxes(tree)[1].props.onCheckedChange as (checked: boolean) => void)(true);
  tree = list.render();
  assert.equal(selectionCount(tree), "100 selected");
  assert.equal(checkboxes(tree)[1].props.checked, false);
});

test("bulk failures remain selected with errors and requests cannot run twice while pending", async () => {
  const calls: string[][] = [];
  let resolveBatch!: (results: flowModel.FlowBulkResult[]) => void;
  const pending = new Promise<flowModel.FlowBulkResult[]>((resolve) => { resolveBatch = resolve; });
  const list = await flowListHarness(2, true, true, async (ids, action) => {
    assert.equal(action, "paused");
    calls.push(ids);
    return pending;
  });
  let tree = list.render();
  (checkboxes(tree)[0].props.onCheckedChange as (checked: boolean) => void)(true);
  tree = list.render();
  const pause = button(tree, "Pause").props.onClick as () => void;
  pause(); pause();
  assert.equal(calls.length, 1);
  tree = list.render();
  assert.equal(button(tree, "Pause").props.disabled, true);
  assert.ok(checkboxes(tree).every((element) => element.props.disabled === true));
  resolveBatch([{ id: "flow-0", ok: true }, { id: "flow-1", ok: false, error: "SMTP configuration missing" }]);
  await new Promise((resolve) => setImmediate(resolve));
  tree = list.render();
  assert.equal(selectionCount(tree), "1 selected");
  assert.equal(checkboxes(tree)[1].props.checked, false);
  assert.equal(checkboxes(tree)[2].props.checked, true);
  assert.equal(button(tree, "Pause").props.disabled, false);
  const alert = elements(tree).find((element) => element.type === notificationToastModule.NotificationToast)!;
  assert.ok(JSON.stringify(alert).includes("SMTP configuration missing"));
  assert.ok(JSON.stringify(alert).includes("Flow 1"));
});

test("bulk deletion waits for confirmation and request failures retain every selected flow", async () => {
  let executions = 0;
  const list = await flowListHarness(2, true, true, async (_ids, action) => {
    executions++;
    assert.equal(action, "delete");
    throw new Error("Network unavailable");
  });
  let tree = list.render();
  (checkboxes(tree)[0].props.onCheckedChange as (checked: boolean) => void)(true);
  tree = list.render();
  (button(tree, "Delete").props.onClick as () => void)();
  assert.equal(executions, 0);
  tree = list.render();
  const confirmation = elements(tree).find((element) => element.type === "ConfirmActionDialog")!;
  assert.equal(confirmation.props.open, true);
  await (confirmation.props.onConfirm as () => Promise<void>)();
  assert.equal(executions, 1);
  tree = list.render();
  assert.equal(selectionCount(tree), "2 selected");
  assert.ok(JSON.stringify(elements(tree).find((element) => element.type === notificationToastModule.NotificationToast)).includes("Network unavailable"));
});

test("run insights can select older failures and paginate beyond the newest 25 runs", async () => {
  const f = fixture("admin");
  f.rows.flow_runs = Array.from({ length: 60 }, (_, index) => ({ id: `failed-${index}`, flow_id: "flow-bob", status: "failed" }));
  f.rows.flow_runs.push({ id: "latest-active", flow_id: "flow-bob", status: "active" });
  const first = await f.runtime.listFlowRunInsights("flow-bob", { status: "failed", page: 0 }) as Array<{ id: string }>;
  const second = await f.runtime.listFlowRunInsights("flow-bob", { status: "failed", page: 1 }) as Array<{ id: string }>;
  assert.equal(first.length, 26);
  assert.equal(second.length, 26);
  assert.equal(first[0].id, "failed-0");
  assert.equal(second[0].id, "failed-25");
  assert.ok(![...first, ...second].some(run => run.id === "latest-active"));
});
