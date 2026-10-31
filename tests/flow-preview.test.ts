import { policyTestDependency } from "./helpers/ai-policy.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { blankStep, defaultFlowInput, flowConditionCriteriaSchema, flowInputSchema } from "../lib/flows.ts";
import { conditionMatches, type FlowFacts } from "../lib/flow-engine.ts";
import * as preview from "../lib/flow-preview.ts";
import * as schema from "../lib/flow-email-test.ts";
import * as engine from "../lib/flow-engine.ts";
import * as flows from "../lib/flows.ts";

const facts: FlowFacts = schema.flowScenarioSchema.parse({ country: "US", fitScore: 8, companyStatus: "qualified" });
const contactId = "00000000-0000-4000-a000-000000000001", companyId = "00000000-0000-4000-a000-000000000002", flowId = "00000000-0000-4000-a000-000000000003";
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { const aiDependency = policyTestDependency(name); if (aiDependency) return aiDependency;  if (name === "server-only") return {}; if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }, Response, Request, URL, Date, Error });
  return exports;
}

test("AND/OR split criteria preserve negative, numeric and missing-property comparisons", () => {
  const rule = { match: "all", rules: [{ field: "country_is", value: "us" }, { field: "fit_score_at_least", fitScore: 7, operator: "gte" }] };
  assert.equal(flowConditionCriteriaSchema.safeParse(rule).success, true);
  assert.equal(conditionMatches(rule, facts), true);
  assert.equal(conditionMatches(rule, { ...facts, fitScore: 6 }), false);
  assert.equal(conditionMatches({ ...rule, match: "any" }, { ...facts, fitScore: 6 }), true);
  assert.equal(conditionMatches({ field: "customer_replied", negate: true }, facts), true);
  assert.equal(conditionMatches({ field: "country_is", value: "U", operator: "starts_with" }, facts), true);
  assert.equal(conditionMatches({ field: "segment_is", operator: "is_not_set" }, facts), true);
  assert.equal(conditionMatches({ field: "fit_score_at_least", fitScore: 0 }, { ...facts, fitScore: null }), false);
  assert.equal(flowConditionCriteriaSchema.safeParse({ match: "any", rules: [] }).success, false);
});

test("scenario preview selects one branch, retains definition addresses, and explains failed entry", () => {
  const split = blankStep("split");
  split.config.paths = [{ id: "yes", name: "US buyers", condition: { field: "country_is", value: "US" }, steps: [{ ...blankStep("create_task"), id: "task" }] }, { id: "other", name: "Everyone else", condition: null, steps: [{ ...blankStep("wait"), id: "wait" }] }];
  const flow = flowInputSchema.parse({ ...defaultFlowInput, triggerConfig: { ...defaultFlowInput.triggerConfig, country: "US" }, steps: [split] });
  const result = preview.previewFlowScenario(flow, facts);
  assert.equal(result.enters, true);
  assert.equal(result.trace[0].pathId, "yes");
  assert.deepEqual(result.trace[1].stepPath, [0, 0, 0]);
  assert.equal(result.checks.find((item) => item.label === "Re-entry criteria")?.passed, null);
  const rejected = preview.previewFlowScenario(flow, { ...facts, country: "GB" });
  assert.equal(rejected.enters, false);
  assert.equal(rejected.trace.length, 0);
});

test("saved-customer preview resolves company from the database, checks re-entry and never mutates records", async () => {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    contacts: [{ id: contactId, company_id: companyId, name: "Sample buyer", email: "sample@example.invalid", unsubscribed: true }],
    flows: [{ id: flowId, user_id: "owner" }], flow_runs: [{ id: "previous", flow_id: flowId, contact_id: contactId }],
  };
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table); const filters: Array<[string, unknown]> = [];
    const q = { select() { return q; }, eq(key: string, value: unknown) { filters.push([key, value]); return q; }, gt() { return q; }, limit() { return q; }, maybeSingle() { return q; }, throwOnError() { return q; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: tables[table]?.find((row) => filters.every(([key, value]) => row[key] === value)) || null }).then(resolve); } };
    return q;
  };
  const service = load("../lib/data/flow-preview.ts", {
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from }) },
    "./flow-runtime.ts": { loadFlowFacts: async (input: { companyId: string; since: string }) => { assert.equal(input.companyId, companyId); assert.ok(Math.abs(Date.now() - Date.parse(input.since)) < 1000, "Old incoming emails must not count as replies after the assumed entry"); return facts; } },
    "../flow-engine.ts": engine, "../flow-email-test.ts": schema, "../flows.ts": flows,
  });
  const input = preview.flowPreviewSchema.parse({ flowId, contactId, flow: { ...defaultFlowInput, triggerConfig: { ...defaultFlowInput.triggerConfig, reentryMode: "no_reentry", country: "US" } } });
  const result = await service.previewFlow(input, "owner") as preview.FlowPreviewResult;
  assert.equal(result.enters, false);
  assert.equal(result.checks.find((item) => item.label === "Re-entry criteria")?.passed, false);
  assert.match(result.warnings.join(" "), /unsubscribed/);
  await assert.rejects(service.previewFlow(input, "another-user"), /cannot inspect/);
  assert.ok(reads.every((name) => ["contacts", "flows", "flow_runs"].includes(name)));
});

test("preview endpoint rejects unauthenticated, foreign-origin and malformed requests before reading customer data", async () => {
  let authenticated = false, calls = 0;
  const route = load("../app/api/flows/preview/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => authenticated ? { id: "member", role: "viewer" } : null },
    "@/lib/flow-preview": preview,
    "@/lib/data/flow-preview": { previewFlow: async () => { calls++; return { ok: true }; } },
  });
  const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/flows/preview", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request({ flow: defaultFlowInput })) as Response).status, 401);
  authenticated = true;
  assert.equal((await route.POST(request({ flow: defaultFlowInput }, "https://foreign.example")) as Response).status, 403);
  assert.equal((await route.POST(request({ flow: {} })) as Response).status, 400);
  assert.equal(calls, 0);
  const response = await route.POST(request({ flow: defaultFlowInput })) as Response;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls, 1);
});
