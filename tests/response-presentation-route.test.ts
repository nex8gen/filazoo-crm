import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as previews from "../lib/ai/response-presentation.ts";
import * as reports from "../lib/ai/record-presentation.ts";

const id = "15693adc-0bdf-4617-b214-000000000001";
const viewer = { id: "viewer", role: "bd_manager", workspaceId: "workspace" };
function fixture({ signedIn = true, restricted = false, fail = false } = {}) {
  const calls: unknown[] = [];
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { getWorkspaceViewer: async () => signedIn ? viewer : null },
    "@/lib/workspace-context": { withWorkspaceViewer: (_actor: unknown, callback: () => unknown) => callback() },
    "@/lib/data/ai-settings": { requireAiFeature: async () => ({}) },
    "@/lib/ai-policy": { restrictedAiContext: () => restricted },
    "@/lib/ai/response-presentation": previews, "@/lib/ai/record-presentation": reports,
    "@/lib/ai/crm-records": { readCrmRecords: async (actor: unknown, input: { resource: string; id: string }) => {
      assert.equal(actor, viewer); calls.push(input);
      if (fail) throw new Error("Private connection or permission details");
      return { records: [{ id: input.id, number: 1017, status: "draft", total_minor: 4963, paid_minor: 0, document: { customerName: "Saved customer", dueDate: "2026-11-12", currency: "USD" } }], coverage: { matching: 1, nextOffset: null } };
    } },
  };
  const exports = {} as { POST: (request: Request) => Promise<Response> };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/ai/assistant/presentation/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Response, URL, JSON, Error, require: (name: string) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; } });
  return { calls, post: (body: unknown, origin = "https://crm.test") => exports.POST(new Request("https://crm.test/api/ai/assistant/presentation", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) })) };
}

test("record preview endpoint authenticates, bounds identifiers and honors restricted AI settings", async () => {
  for (const [options, expected] of [[{ signedIn: false }, 401], [{ restricted: true }, 403]] as const) {
    const mock = fixture(options), response = await mock.post({ records: [{ resource: "invoices", id }] });
    assert.equal(response.status, expected); assert.equal(mock.calls.length, 0);
  }
  for (const body of [{ records: [{ resource: "settings", id }] }, { records: [{ resource: "invoices", id, balance: 9999 }] }, { records: Array.from({ length: 11 }, () => ({ resource: "invoices", id })) }]) {
    const mock = fixture(), response = await mock.post(body); assert.equal(response.status, 400); assert.equal(mock.calls.length, 0);
  }
  const origin = fixture(); assert.equal((await origin.post({ records: [{ resource: "invoices", id }] }, "https://bad.test")).status, 403); assert.equal(origin.calls.length, 0);
});

test("legacy previews deduplicate IDs, return actual saved values and do not leak read failures", async () => {
  const mock = fixture(), response = await mock.post({ records: [{ resource: "invoices", id }, { resource: "invoices", id }] });
  assert.equal(response.status, 200); assert.equal(mock.calls.length, 1);
  const body = await response.json(), row = body.presentation.sections[0].rows[0];
  assert.equal(row.title, "#1017"); assert.equal(row.status, "Draft"); assert.equal(row.cells.balance, "USD 49.63");
  assert.equal(body.presentation.sections[0].metrics.find((item: { label: string }) => item.label === "Overdue").value, "0");
  const denied = fixture({ fail: true }), failure = await denied.post({ records: [{ resource: "invoices", id }] });
  assert.equal(failure.status, 403); assert.doesNotMatch(await failure.text(), /Private connection/);
});
