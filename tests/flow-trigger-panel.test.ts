import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as flows from "../lib/flows.ts";
import * as triggerEditor from "../lib/flow-trigger-editor.ts";
import * as segments from "../lib/segment-flows.ts";

type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function harness(initial: flows.FlowInput = flows.defaultFlowInput, disabled = false) {
  let flow = structuredClone(initial), writes = 0, previews = 0, cursor = 0;
  const state: unknown[] = [];
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: { useState(value: unknown) { const index = cursor++; if (!(index in state)) state[index] = value; return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; } },
    "@/lib/flows": flows,
    "@/lib/flow-trigger-editor": triggerEditor,
    "@/lib/segment-flows": segments,
  };
  const output: Record<string, (props: Record<string, unknown>) => Element> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/flow-trigger-panel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: output, require: (name: string) => dependencies[name] || components });
  const render = () => { cursor = 0; return output.FlowTriggerPanel({ flow, disabled, onChange: (next: flows.FlowInput) => { flow = next; writes++; }, onClose: () => {}, onPreview: () => { previews++; }, filterOptions: { segments: ["Wholesale"], countries: ["Canada", "France"] }, receivingMailboxes: [] }); };
  return { render, get flow() { return flow; }, get writes() { return writes; }, get previews() { return previews; } };
}
function button(tree: Element, label: string) {
  return elements(tree).find(node => node.type === "Button" && node.props.children === label)!;
}
function click(tree: Element, label: string) { (button(tree, label).props.onClick as () => void)(); }
function choice(tree: Element, label: string) {
  return elements(tree).find(node => typeof node.type === "function" && node.type.name === "TriggerChoice" && node.props.label === label)!;
}

test("trigger overview contains summaries and preview, with filters kept out of the main panel", () => {
  const app = harness();
  const tree = app.render();
  assert.ok(JSON.stringify(tree).includes("No profile filters applied."));
  assert.equal(elements(tree).some(node => node.type === "FlowCustomerPicker"), false);
  assert.equal(elements(tree).some(node => typeof node.type === "function" && node.type.name === "TriggerChoice"), false);
  assert.equal(elements(tree).filter(node => node.type === "input" && node.props.type === "radio").length, 3);
  click(tree, "Preview");
  assert.equal(app.previews, 1);
});

test("profile filters only update the workflow when saved; cancel discards the edits", () => {
  const app = harness();
  click(app.render(), "Add");
  let tree = app.render();
  (choice(tree, "Country").props.onChange as (value: string) => void)("Canada");
  assert.equal(app.writes, 0);
  click(app.render(), "Cancel");
  assert.equal(app.flow.triggerConfig.country, undefined);
  click(app.render(), "Add");
  tree = app.render();
  (choice(tree, "Country").props.onChange as (value: string) => void)("Canada");
  click(app.render(), "Save");
  assert.equal(app.flow.triggerConfig.country, "Canada");
  assert.equal(app.writes, 1);
  assert.ok(JSON.stringify(app.render()).includes("Country is Canada"));
});

test("event editing preserves existing filters and uses supported event options", () => {
  const app = harness({ ...flows.defaultFlowInput, triggerConfig: { ...flows.defaultFlowInput.triggerConfig, country: "Canada", reentryMode: "no_reentry" } });
  click(app.render(), "Change");
  const selector = choice(app.render(), "Trigger event");
  assert.equal((selector.props.options as unknown[]).length, 6);
  (selector.props.onChange as (value: string) => void)("email_received");
  click(app.render(), "Save");
  assert.equal(app.flow.triggerType, "email_received");
  assert.equal(app.flow.triggerConfig.country, "Canada");
  assert.equal(app.flow.triggerConfig.reentryMode, "no_reentry");
  assert.ok(!("amount" in app.flow.triggerConfig));
});

test("invalid fit scores stay in the editor and do not reach the workflow", () => {
  const app = harness();
  click(app.render(), "Add");
  const score = elements(app.render()).find(node => node.type === "Input" && node.props.id === "trigger-min-fit-score")!;
  (score.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "11" } });
  click(app.render(), "Save");
  assert.equal(app.writes, 0);
  assert.ok(elements(app.render()).some(node => node.props.role === "alert"));
});

test("segment audiences retain their fixed trigger, customer scope, and re-entry policy", () => {
  const app = harness(segments.createSegmentFlowDraft({ id: "11111111-1111-4111-8111-111111111111", name: "Wholesale", kind: "saved" }));
  const tree = app.render();
  assert.equal(button(tree, "Change"), undefined);
  assert.equal(elements(tree).filter(node => node.type === "input" && node.props.type === "radio").length, 0);
  assert.ok(elements(tree).some(node => node.props.href === segments.segmentCompaniesHref(app.flow.triggerConfig)));
  click(tree, "Add");
  assert.equal(elements(app.render()).some(node => node.type === "FlowCustomerPicker"), false);
  assert.equal(choice(app.render(), "Company segment"), undefined);
});

test("viewers can preview but cannot edit or apply trigger settings", () => {
  const app = harness(flows.defaultFlowInput, true);
  const tree = app.render();
  assert.equal(button(tree, "Change").props.disabled, true);
  assert.equal(button(tree, "Add").props.disabled, true);
  assert.equal(elements(tree).find(node => node.props["aria-label"] === "Re-entry criteria")!.props.disabled, true);
  click(tree, "Preview");
  assert.equal(app.previews, 1);
  assert.equal(app.writes, 0);
});

test("re-entry controls retain CRM filters and supply a valid waiting period", () => {
  const app = harness({ ...flows.defaultFlowInput, triggerConfig: { ...flows.defaultFlowInput.triggerConfig, country: "Canada" } });
  const option = elements(app.render()).find(node => node.type === "input" && node.props.value === "after_period")!;
  (option.props.onChange as () => void)();
  assert.equal(app.flow.triggerConfig.country, "Canada");
  assert.equal(app.flow.triggerConfig.reentryMode, "after_period");
  assert.equal(app.flow.triggerConfig.reentryAfterAmount, 30);
  assert.equal(app.flow.triggerConfig.reentryAfterUnit, "days");
  assert.equal(triggerEditor.triggerSettingsError(app.flow.triggerType, app.flow.triggerConfig), null);
});

test("email-scoped filter editing keeps the locked recipient and hides customer selection", () => {
  const scope = { flowScope: "email", scopeCompanyId: "11111111-1111-4111-8111-111111111111", scopeContactId: "22222222-2222-4222-8222-222222222222", scopeLabel: "buyer@example.com" };
  const app = harness({ ...flows.defaultFlowInput, triggerConfig: { ...flows.defaultFlowInput.triggerConfig, ...scope } });
  click(app.render(), "Add");
  const tree = app.render();
  assert.equal(elements(tree).some(node => node.type === "FlowCustomerPicker"), false);
  assert.ok(JSON.stringify(tree).includes("Only this email address"));
  (choice(tree, "Country").props.onChange as (value: string) => void)("Canada");
  click(app.render(), "Save");
  assert.equal(app.flow.triggerConfig.scopeContactId, scope.scopeContactId);
  assert.equal(app.flow.triggerConfig.country, "Canada");
});
