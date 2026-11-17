import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { flowEditorSaveSchema } from "../lib/flow-editor-draft.ts";
import * as flows from "../lib/flows.ts";

const id = "11111111-1111-4111-8111-111111111111";
const stamp = "2026-11-17T00:00:00Z";
function request(ready = false) {
  return { flowId: id, create: false, revision: 0, baseUpdatedAt: stamp, flow: { ...structuredClone(flows.defaultFlowInput), status: "live", steps: [flows.blankStep(ready ? "wait" : "send_email")] } };
}
function fixture(role = "operator", owner = "actor") {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  let providerFailure = false;
  let race = false;
  let saved = { ...structuredClone(flows.defaultFlowInput), id, status: "live", createdBy: owner, updatedAt: stamp, steps: [flows.blankStep("stop")] } as flows.AutomationFlow;
  const db = { from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; }, update: (data: Record<string, unknown>) => { calls.push({ name: `update:${table}`, args: data }); return query; }, throwOnError: async () => ({ error: null }), maybeSingle: async () => ({ data: table === "flows" && (!filters.user_id || filters.user_id === owner) ? { user_id: owner, trigger_config: {} } : null, error: null }) };
    return query;
  }, rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "save_flow_editor_draft") saved = { ...saved, editorDraft: { definition: args.p_input as flows.FlowInput, revision: Number(args.p_revision) + 1 + (race ? 1 : 0), baseUpdatedAt: stamp } };
    if (name === "publish_flow_editor_draft") { const input = args.p_input as flows.FlowInput; saved = { ...saved, ...input, steps: input.steps as flows.FlowStep[], editorDraft: undefined }; }
    return { error: null, data: id };
  } };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../supabase/admin.ts": { createSupabaseAdmin: () => db }, "../flows.ts": flows,
    "./email-flows.ts": { validateEmailFlowScope: async (value: unknown) => value },
    "./flows.ts": { getFlowEditingResult: async () => structuredClone(saved) },
    "./flow-runtime.ts": { validateFlowSenderAccess: async () => {}, validateFlowResources: async () => { calls.push({ name: "validate" }); if (providerFailure) throw new Error("Email provider unavailable"); } },
    "../flow-execution-errors.ts": { workflowErrorMessage: (cause: Error) => cause.message },
  };
  const output = {} as { saveFlowEditingCopy: (viewer: unknown, input: unknown) => Promise<flows.AutomationFlow> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/flow-editor-draft.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: output, Error, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { calls, save: (input: unknown) => output.saveFlowEditingCopy({ id: "actor", role }, input), failProvider() { providerFailure = true; }, race() { race = true; } };
}

test("editing schema accepts incomplete action settings while publication validation still rejects them", () => {
  assert.equal(flowEditorSaveSchema.safeParse(request()).success, true);
  assert.equal(flows.flowInputSchema.safeParse(request().flow).success, false);
  const duplicate = request(); duplicate.flow.steps.push(duplicate.flow.steps[0]);
  assert.equal(flowEditorSaveSchema.safeParse(duplicate).success, false);
});

test("autosaving an incomplete action never runs provider checks or publishes it", async () => {
  const f = fixture(); const result = await f.save(request());
  assert.equal(result.steps[0].type, "stop");
  assert.equal(result.editorDraft?.definition.steps[0].type, "send_email");
  assert.deepEqual(f.calls.map(call => call.name), ["save_flow_editor_draft"]);
});

test("ready actions publish automatically after live provider checks with a revision guard", async () => {
  const f = fixture(); const result = await f.save(request(true));
  assert.equal(result.editorDraft, undefined);
  assert.equal(result.steps[0].type, "wait");
  assert.deepEqual(f.calls.map(call => call.name), ["save_flow_editor_draft", "validate", "publish_flow_editor_draft"]);
  assert.equal(f.calls[2].args?.p_revision, 1);
});

test("provider failures preserve the saved editing copy and the prior live actions", async () => {
  const f = fixture(); f.failProvider(); const result = await f.save(request(true));
  assert.equal(result.steps[0].type, "stop");
  assert.equal(result.editorDraft?.definition.steps[0].type, "wait");
  assert.equal(result.editorDraft?.publicationError, "Email provider unavailable");
  assert.equal(f.calls.some(call => call.name === "publish_flow_editor_draft"), false);
});

test("another editor's newer copy cannot be published by an older autosave request", async () => {
  const f = fixture(); f.race();
  await assert.rejects(f.save(request(true)), /Reload before saving/);
  assert.equal(f.calls.some(call => call.name === "publish_flow_editor_draft"), false);
});

test("viewers and other creators cannot autosave or impersonate a workflow owner", async () => {
  const viewer = fixture("viewer"); await assert.rejects(viewer.save(request()), /Access denied/); assert.equal(viewer.calls.length, 0);
  const other = fixture("operator", "other"); await assert.rejects(other.save(request()), /Workflow not found/); assert.equal(other.calls.length, 0);
  const admin = fixture("admin", "other"); await admin.save(request()); assert.equal(admin.calls[0].args?.p_user_id, "other");
});

function routeFixture() {
  let saved = 0, conflict = false, denied = false;
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { assert.ok(roles.includes("bd_manager")); assert.equal(roles.includes("viewer"), false); if (denied) throw new Error("Access denied"); return { id: "actor", role: "operator" }; } },
    "@/lib/workspace-context": { withWorkspaceViewer: async (_viewer: unknown, run: () => Promise<unknown>) => run() },
    "@/lib/flow-editor-draft": { flowEditorSaveSchema },
    "@/lib/data/flow-editor-draft": { saveFlowEditingCopy: async () => { saved++; if (conflict) throw new Error("Workflow changed. Reload before saving."); return { id }; } },
  };
  const output = {} as { POST: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/flows/editor-draft/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: output, Error, Response, TextEncoder, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { post: (body: string) => output.POST(new Request("https://example.test/api/flows/editor-draft", { method: "POST", body })), get saved() { return saved; }, conflict() { conflict = true; }, deny() { denied = true; } };
}

test("autosave route validates requests and returns persisted copies without caching", async () => {
  const f = routeFixture();
  assert.equal((await f.post("{")).status, 400);
  assert.equal((await f.post(JSON.stringify({ ...request(), revision: -1 }))).status, 400);
  assert.equal((await f.post("x".repeat(750001))).status, 413);
  assert.equal(f.saved, 0);
  const response = await f.post(JSON.stringify(request()));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.equal(f.saved, 1);
});

test("autosave route reports conflicts and denies unauthorized roles before writing", async () => {
  const f = routeFixture(); f.conflict(); assert.equal((await f.post(JSON.stringify(request()))).status, 409);
  const denied = routeFixture(); denied.deny(); await assert.rejects(denied.post(JSON.stringify(request())), /Access denied/); assert.equal(denied.saved, 0);
});
