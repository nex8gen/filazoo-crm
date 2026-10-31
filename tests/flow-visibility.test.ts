import { policyTestDependency } from "./helpers/ai-policy.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as flowTree from "../lib/flow-tree.ts";
import * as flowMailboxes from "../lib/flow-mailboxes.ts";
import vm from "node:vm";
import ts from "typescript";
import { flowInputSchema } from "../lib/flows.ts";
import * as flowModel from "../lib/flows.ts";
import * as flowAudit from "../lib/flow-audit.ts";
import * as segmentFlowModel from "../lib/segment-flows.ts";

function loadModule(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => policyTestDependency(name) ?? (dependencies[name] ?? {}), Response, Error, Date });
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
  const dependencies = { "../auth.ts": auth, "../supabase/admin.ts": { createSupabaseAdmin: () => admin }, "../flows.ts": flowModel };
  const flows = loadModule("../lib/data/flows.ts", { ...dependencies, "./flow-runtime.ts": { validateFlowResources: async (userId: string) => { validations.push(userId); } } });
  const runtime = loadModule("../lib/data/flow-runtime.ts", dependencies);
  return { flows, runtime, calls, rows, auth, validations, fail: (message: string) => { failure = message; } };
}

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

test("shared reads reject nonmembers before issuing privileged queries", async () => {
  const f = fixture(null);
  await assert.rejects(f.flows.listWorkspaceFlows(), /Access denied/);
  await assert.rejects(f.runtime.listFlowRunInsights("flow-bob"), /Access denied/);
  assert.equal(f.calls.length, 0);
});

test("email and company flows are absent from shared and legacy lists and cannot be broadened on edit", async () => {
  for (const scope of ["email", "company"]) {
    const f = fixture();
    f.rows.flows[0].trigger_config = { flowScope: scope, scopeCompanyId: "company", ...(scope === "email" ? { scopeContactId: "contact" } : {}) };
    assert.equal((await f.flows.listWorkspaceFlows() as flowModel.AutomationFlow[]).length, 1);
    assert.equal((await f.flows.listFlows("alice") as flowModel.AutomationFlow[]).length, 0);
    await assert.rejects(f.flows.updateFlow("alice", "flow-alice", flowModel.defaultFlowInput), /must keep its original/);
    assert.equal(f.calls.filter((call) => call.operation === "save_automation_flow").length, 0);
  }
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
    const history = await insights(undefined, { params: Promise.resolve({ id: "flow-bob" }) }) as Response;
    assert.equal(history.status, 200);
    assert.equal(history.headers.get("cache-control"), "no-store");
    assert.equal((await history.json()).runs[0].id, "run-bob");
    const missing = await insights(undefined, { params: Promise.resolve({ id: "missing" }) }) as Response;
    assert.equal(missing.status, 404);
  }
});

type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

function builder(hooks?: { values: unknown[]; cursor: number }) {
  // Inspect the actual component output and handlers with React/browser
  // boundaries isolated, so these tests need no session or email provider.
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props });
  function state(value: unknown): [unknown, (next: unknown) => void] {
    if (!hooks) return [value, () => {}];
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = value;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next; }];
  }
  const dependencies = new Proxy({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: {
      lazy: () => "LazyComponent", Suspense: "Suspense",
      useState: state, useRef: (value: unknown) => state({ current: value })[0],
      useEffect: () => {}, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
    },
    "@dnd-kit/core": { ...components, useSensors: () => [], useSensor: () => ({}) },
    "@/lib/flows": flowModel,
    "@/lib/segment-flows": segmentFlowModel,
    "@/lib/flow-audit": flowAudit,
    "@/lib/flow-tree": flowTree,
    "@/lib/flow-mailboxes": flowMailboxes,
    sonner: { toast: { error: () => {}, success: () => {} } },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (text: string) => text }) },
  }, { get: (target, name) => Reflect.get(target, name) ?? components });
  return loadModule("../components/flow-builder.tsx", dependencies).FlowBuilder;
}

test("shared flow list shows creators and offers View while reserving mutation controls for owners", async () => {
  const initialFlows = ["alice", "bob"].map((createdBy) => ({
    ...flowModel.defaultFlowInput, id: `flow-${createdBy}`, name: "3-step follow-up", createdBy,
    updatedAt: "2026-10-27T00:00:00Z", steps: [], activeRuns: 0, completedRuns: 0,
  }));
  const render = builder();
  const tree = await render({ initialFlows, viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [{ id: "bob", label: "Bob" }], filterOptions: {} });
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
  assert.ok(JSON.stringify(output).includes("Bob"));
  const headers = elements(output).filter((element) => element.type === "TableHead");
  assert.equal(headers[2].props.children, "Created by");
  const cells = elements(output).filter((element) => element.type === "TableCell");
  assert.equal(cells[2].props.children, "You");
  assert.equal(cells[11].props.children, "Bob");

  const adminTree = await render({ ...list.props, initialFlows, viewerId: "alice", isAdmin: true, canEdit: true, mailboxOptions: [], filterOptions: {} });
  const adminList = elements(adminTree).find((element) => typeof element.type === "function" && element.type.name === "FlowListView")!;
  const adminOutput = (adminList.type as (props: Element["props"]) => Element)(adminList.props);
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

test("launching from any segment shows its fixed audience without customer or trigger selectors", async () => {
  for (const kind of ["saved", "business"]) {
    const initialDraft = segmentFlowModel.createSegmentFlowDraft({ id: "11111111-1111-4111-8111-111111111111", name: "Historical email lead", kind });
    const tree = await builder()({ initialFlows: [], initialDraft, viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: { segments: ["Historical email lead"], countries: ["US"] } });
    const inspector = elements(tree).find((node) => typeof node.type === "function" && node.type.name === "TriggerInspector")!;
    const output = (inspector.type as (props: Element["props"]) => Element)(inspector.props);
    assert.equal(elements(output).some((node) => node.type === "FlowCustomerPicker"), false);
    assert.equal(elements(output).some((node) => typeof node.type === "function" && node.type.name === "FlowSelect"), false);
    assert.ok(JSON.stringify(output).includes("Segment trigger is ready"));
    assert.ok(JSON.stringify(output).includes("Historical email lead"));
    assert.ok(elements(output).some((node) => node.props.href === segmentFlowModel.segmentCompaniesHref(initialDraft.triggerConfig)));
  }
});

test("email builder prefills the scoped trigger and changing events retains its fixed recipient", async () => {
  const scope = { flowScope: "email", scopeCompanyId: "11111111-1111-4111-8111-111111111111", scopeContactId: "22222222-2222-4222-8222-222222222222", scopeLabel: "customer@example.com" };
  const hooks = { values: [] as unknown[], cursor: 0 };
  const render = builder(hooks);
  const props = { initialFlows: [], viewerId: "alice", canEdit: true, mailboxOptions: [], memberOptions: [], filterOptions: { segments: [], countries: [] }, initialDraft: { ...flowModel.defaultFlowInput, triggerType: "email_received", triggerConfig: scope }, scopedContext: { config: scope, refreshUrl: "/api/email/flows?recipient=customer@example.com", returnHref: "/email?thread=test" } };
  const tree = await render(props);
  const inspector = elements(tree).find((node) => typeof node.type === "function" && node.type.name === "TriggerInspector")!;
  const output = (inspector.type as (props: Element["props"]) => Element)(inspector.props);
  assert.equal(elements(output).some((node) => node.type === "FlowCustomerPicker"), false);
  const selector = elements(output).find((node) => typeof node.type === "function" && node.type.name === "FlowSelect")!;
  (selector.props.onChange as (value: string) => void)("no_reply");
  hooks.cursor = 0;
  const updated = await render(props);
  const canvas = elements(updated).find((node) => typeof node.type === "function" && node.type.name === "FlowCanvas")!;
  const draft = canvas.props.draft as flowModel.FlowInput;
  assert.equal(draft.triggerType, "no_reply");
  assert.equal(draft.triggerConfig.scopeContactId, scope.scopeContactId);
  assert.equal(draft.triggerConfig.scopeCompanyId, scope.scopeCompanyId);
});

async function flowListHarness(count: number, isAdmin = true, canEdit = true, onBulkAction: (ids: string[], action: flowModel.FlowBulkAction) => Promise<flowModel.FlowBulkResult[]> = async (ids) => ids.map((id) => ({ id, ok: true }))) {
  const hooks = { values: [] as unknown[], cursor: 0 };
  const initialFlows = Array.from({ length: count }, (_, index) => ({
    ...flowModel.defaultFlowInput, id: `flow-${index}`, name: `Flow ${index}`,
    createdBy: index % 2 === 0 ? "alice" : "bob", updatedAt: "2026-10-27T00:00:00Z", steps: [],
  }));
  const tree = await builder(hooks)({ initialFlows, viewerId: "alice", isAdmin, canEdit, mailboxOptions: [], memberOptions: [], filterOptions: {} });
  const list = elements(tree).find((element) => typeof element.type === "function" && element.type.name === "FlowListView")!;
  const props = { ...list.props, onBulkAction };
  hooks.values = [];
  const render = () => { hooks.cursor = 0; return (list.type as (props: Element["props"]) => Element)(props); };
  return { render };
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
  const alert = elements(tree).find((element) => element.props.role === "alert")!;
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
  assert.ok(JSON.stringify(elements(tree).find((element) => element.props.role === "alert")).includes("Network unavailable"));
});
