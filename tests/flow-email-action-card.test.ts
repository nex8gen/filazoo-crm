import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as editor from "../lib/flow-email-editor.ts";
import * as flows from "../lib/flows.ts";

type Element = { type: string; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element;
  return [node, ...elements(node.props.children)];
}
function render(status: string, saved: boolean, emailStatus = "live", emailName = "WELCOME10", onEmailStatusChange: (id: string, status: string) => void = () => {}) {
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const dependencies: Record<string, unknown> = { "react/jsx-runtime": { jsx, jsxs: jsx }, "@/lib/flows": flows, "@/components/flow-action-card": { FlowActionCard: "FlowActionCard" }, "@/lib/flow-email-editor": editor, "@/components/flow-email-performance": { useEmailPerformance: () => ({ status, savedIds: saved ? ["email"] : [], emailNames: { email: "Email #1" }, onEmailStatusChange }), FlowEmailMetrics: "FlowEmailMetrics", FlowEmailStatus: "FlowEmailStatus" } };
  const output: Record<string, (props: Record<string, unknown>) => Element> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/flow-email-action-card.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: output, require: (name: string) => dependencies[name] });
  return output.FlowEmailActionCard({ actionId: "email", config: { ...flows.defaultFlowInput.steps[1].config, emailStatus, emailName, smartSendingHours: 16 }, label: "Email", summary: "Helpful reminder" });
}

test("saved live and paused email cards expand with the saved name, subject, real metrics, and status", () => {
  for (const status of ["live", "paused"]) {
    const tree = render(status, true, "draft");
    assert.equal(tree.props.expanded, true);
    assert.equal(tree.props.label, "WELCOME10");
    assert.equal(tree.props.summary, "Helpful reminder");
    assert.ok(elements(tree.props.body).some(node => node.props.children === "Just checking in"));
    assert.ok(elements(tree.props.body).some(node => node.type === "FlowEmailMetrics" && node.props.actionId === "email" && node.props.card));
    assert.ok(elements(tree.props.detail).some(node => node.type === "FlowEmailStatus" && node.props.status === "draft"));
    assert.ok(elements(tree.props.detail).some(node => node.props.children === "Smart sending"));
    assert.ok(elements(tree.props.detail).some(node => node.props.children === "UTM tracking"));
  }
});

test("draft workflows and unsaved emails hide performance while retaining their own email status", () => {
  for (const [status, saved] of [["draft", true], ["live", false]] as const) {
    const tree = render(status, saved, "draft");
    assert.equal(tree.props.expanded, false);
    assert.equal(tree.props.body, undefined);
    assert.ok(elements(tree.props.detail).some(node => node.type === "FlowEmailStatus" && node.props.status === "draft"));
  }
});

test("the card names unnamed emails consistently and changes only its own status", () => {
  const changes: string[][] = [];
  const tree = render("live", true, "live", "", (id, status) => { changes.push([id, status]); });
  assert.equal(tree.props.label, "Email #1");
  const control = elements(tree.props.detail).find(node => node.type === "FlowEmailStatus")!;
  (control.props.onChange as (status: string) => void)("draft");
  assert.deepEqual(changes, [["email", "draft"]]);
});
