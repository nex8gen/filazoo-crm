import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as flowModel from "../lib/flows.ts";

const companyId = "11111111-1111-4111-8111-111111111111";
const contactId = "22222222-2222-4222-8222-222222222222";
type Row = Record<string, unknown>;
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? {}, Response, Request, URL, Error });
  return exports;
}

function fixture() {
  let role: string | null = "operator";
  let failure = false;
  const calls: string[] = [];
  const rows: Record<string, Row[]> = {
    companies: [{ id: companyId, name: "Company A" }],
    contacts: [{ id: contactId, company_id: companyId, email: "customer@example.com" }],
    pipeline: [{ company_id: companyId, owner_id: "alice" }],
    flows: [], flow_steps: [], flow_runs: [],
  };
  const admin = {
    from(table: string) {
      calls.push(table);
      let selected = rows[table];
      const result = () => ({ data: selected, error: failure ? { message: "unavailable" } : null });
      const query = {
        select() { return query; }, order() { return query; },
        eq(key: string, value: unknown) { selected = selected.filter((row) => (key.includes("->>") ? (row[key.split("->>")[0]] as Row)?.[key.split("->>")[1]] : row[key]) === value); return query; },
        ilike(key: string, value: string) { selected = selected.filter((row) => String(row[key]).toLowerCase() === value.toLowerCase()); return query; },
        in(key: string, values: unknown[]) { selected = selected.filter((row) => values.includes(row[key])); return query; },
        limit(value: number) { selected = selected.slice(0, value); return query; },
        range(from: number, to: number) { selected = selected.slice(from, to + 1); return query; },
        async maybeSingle() { return { ...result(), data: selected[0] ?? null }; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
    async rpc(_name: string, args: { p_input: flowModel.FlowInput; p_user_id: string; p_flow_id: string | null }) {
      const input = args.p_input;
      const id = args.p_flow_id ?? "saved";
      const saved = { id, user_id: args.p_user_id, created_by: args.p_user_id, name: input.name, status: input.status, trigger_type: input.triggerType, trigger_config: input.triggerConfig };
      const existing = rows.flows.find((row) => row.id === id);
      if (existing) Object.assign(existing, saved); else rows.flows.push(saved);
      rows.flow_steps = input.steps.map((step, index) => ({ ...step, id: `step-${index}`, flow_id: id, position: index }));
      return { data: id, error: null };
    },
  };
  const auth = { requireWorkspaceMember: async () => { if (!role) throw new Error("Access denied."); return { id: "alice", role }; } };
  const dependencies = { zod: { z }, "../auth.ts": auth, "../supabase/admin.ts": { createSupabaseAdmin: () => admin }, "../flows.ts": flowModel };
  const scope = load("../lib/data/email-flows.ts", dependencies);
  const flows = load("../lib/data/flows.ts", { ...dependencies, "./email-flows.ts": scope });
  return { rows, calls, scope, flows, auth, role: (value: string | null) => { role = value; }, fail: () => { failure = true; } };
}

test("email scope resolves the real saved contact/company and checks assignments", async () => {
  const app = fixture();
  const scope = await app.scope.resolveEmailFlowScope({ recipient: "CUSTOMER@example.com", scope: "email", companyId }) as flowModel.JsonConfig;
  assert.equal(scope.scopeContactId, contactId);
  assert.equal(scope.scopeCompanyId, companyId);
  assert.equal(scope.scopeLabel, "customer@example.com");
  const company = await app.scope.resolveEmailFlowScope({ recipient: "customer@example.com", scope: "company" }) as flowModel.JsonConfig;
  assert.equal(company.scopeLabel, "Company A");
  assert.equal(company.scopeContactId, undefined);
  app.role("bd_manager");
  await app.scope.validateEmailFlowScope(scope);
  app.rows.pipeline[0].owner_id = "bob";
  await assert.rejects(app.scope.validateEmailFlowScope(scope), /Access denied/);
  app.role(null);
  const count = app.calls.length;
  await assert.rejects(app.scope.resolveEmailFlowScope({ recipient: "customer@example.com" }), /Access denied/);
  assert.equal(app.calls.length, count);
});

test("unknown/ambiguous contacts and changed companies fail without creating a flow", async () => {
  const app = fixture();
  await assert.rejects(app.scope.resolveEmailFlowScope({ recipient: "missing@example.com" }), /Save this email as a contact/);
  await assert.rejects(app.scope.resolveEmailFlowScope({ recipient: "bad-address" }));
  app.rows.contacts.push({ ...app.rows.contacts[0], id: companyId });
  await assert.rejects(app.scope.resolveEmailFlowScope({ recipient: "customer@example.com" }), /Save this email as a contact/);
  app.rows.contacts[0].company_id = "another-company";
  await assert.rejects(app.scope.validateEmailFlowScope({ flowScope: "email", scopeCompanyId: companyId, scopeContactId: contactId }), /no longer belongs/);
  assert.equal(app.rows.flows.length, 0);
  app.fail();
  await assert.rejects(app.scope.resolveEmailFlowScope({ recipient: "customer@example.com" }), /unavailable/);
});

test("saved scoped flows reopen from Email and stay absent from general flow lists", async () => {
  const app = fixture();
  for (const flowScope of ["email", "company"]) {
    const config = await app.scope.resolveEmailFlowScope({ recipient: "customer@example.com", scope: flowScope }) as flowModel.JsonConfig;
    const flow = await app.flows.createFlow("alice", { ...flowModel.defaultFlowInput, triggerConfig: { ...flowModel.defaultFlowInput.triggerConfig, ...config } }) as flowModel.AutomationFlow;
    assert.equal(flow.id, "saved");
    assert.equal(flow.triggerConfig.flowScope, flowScope);
    assert.equal((await app.flows.listWorkspaceFlows() as unknown[]).length, 0);
    assert.equal((await app.flows.listFlows("alice") as unknown[]).length, 0);
    assert.equal((await app.flows.listEmailFlows(config) as flowModel.AutomationFlow[])[0].id, flow.id);
    assert.equal((await app.flows.listEmailFlows({ ...config, scopeContactId: "other-contact", flowScope: "company" }) as unknown[]).length, 0);
    await assert.rejects(app.flows.updateFlow("alice", flow.id, flowModel.defaultFlowInput), /must keep its original/);
    app.rows.flows = [];
  }
});

test("email flow refresh API uses resolved scope, does not cache, and propagates failures", async () => {
  const app = fixture();
  const route = load("../app/api/email/flows/route.ts", { "@/lib/auth": app.auth, "@/lib/data/email-flows": app.scope, "@/lib/data/flows": app.flows }).GET;
  const request = () => new Request("http://localhost/api/email/flows?recipient=customer%40example.com");
  const response = await route(request()) as Response;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).flows.length, 0);
  app.fail();
  assert.equal((await route(request()) as Response).status, 400);
  app.role(null);
  await assert.rejects(route(request()), /Access denied/);
});
