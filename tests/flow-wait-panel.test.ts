import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { JsonConfig } from "../lib/flows.ts";
import * as waitEditor from "../lib/flow-wait-editor.ts";
import type { FlowPanelEditor } from "../lib/flow-editor-session.ts";

type Element = { type: string; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function harness(initial: JsonConfig = { amount: 1, unit: "days" }, disabled = false, trail: string[] = []) {
  let config = structuredClone(initial), writes = 0, closes = 0, cursor = 0;
  const state: unknown[] = [];
  const editorRef: { current: FlowPanelEditor | null } = { current: null };
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useEffect() {}, useImperativeHandle(ref: typeof editorRef, read: () => FlowPanelEditor) { if (ref) ref.current = read(); }, useState(value: unknown) { const index = cursor++; if (!(index in state)) state[index] = typeof value === "function" ? value() : value; return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; } },
    "@/lib/flow-wait-editor": waitEditor,
  };
  const output: Record<string, (props: Record<string, unknown>) => Element> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/flow-wait-panel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: output, require: (name: string) => dependencies[name] || components });
  const render = () => { cursor = 0; return output.FlowWaitPanel({ config, disabled, trail, editorRef, onChange: (next: JsonConfig) => { config = next; writes++; }, onClose: () => { closes++; } }); };
  return { render, editorRef, get config() { return config; }, get writes() { return writes; }, get closes() { return closes; } };
}
function control(tree: Element, name: string) { return elements(tree).find(node => node.props["aria-label"] === name)!; }
function button(tree: Element, label: string) { return elements(tree).find(node => node.type === "Button" && node.props.children === label)!; }
function input(tree: Element, id: string, value: string) { const field = elements(tree).find(node => node.props.id === id)!; if (field.type === "TimePicker") (field.props.onValueChange as (value: string) => void)(value); else (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); }
function check(tree: Element, name: string, checked: boolean) { (control(tree, name).props.onCheckedChange as (checked: boolean) => void)(checked); }
function click(tree: Element, name: string) { (button(tree, name).props.onClick as () => void)(); }

test("delay edits stay local until Save, including duration and unit", () => {
  const app = harness();
  assert.equal(button(app.render(), "Save").props.disabled, true);
  input(app.render(), "flow-wait-amount", "3");
  (elements(app.render()).find(node => node.type === "Select")!.props.onValueChange as (value: string) => void)("hours");
  assert.equal(app.writes, 0);
  assert.equal(app.config.amount, 1);
  click(app.render(), "Save");
  assert.equal(app.config.amount, 3);
  assert.equal(app.config.unit, "hours");
  assert.equal(app.writes, 1);
  assert.equal(app.closes, 1);
});

test("the navigation guard can read and validate pending delay fields without applying them", () => {
  const app = harness();
  input(app.render(), "flow-wait-amount", "7"); app.render();
  assert.equal(app.editorRef.current!.hasChanges(), true);
  const pending = app.editorRef.current!.prepare();
  assert.equal(pending.ok && pending.config?.amount, 7);
  assert.equal(app.config.amount, 1);
  assert.equal(app.writes, 0);
  input(app.render(), "flow-wait-amount", "0"); app.render();
  assert.equal(app.editorRef.current!.prepare().ok, false);
  app.editorRef.current!.reset(); app.render();
  assert.equal(app.editorRef.current!.hasChanges(), false);
});

test("Close and header dismissal discard pending changes", () => {
  for (const header of [false, true]) {
    const app = harness();
    input(app.render(), "flow-wait-amount", "5");
    if (header) (control(app.render(), "Close time delay settings").props.onClick as () => void)();
    else click(app.render(), "Close");
    assert.equal(app.writes, 0);
    assert.equal(app.config.amount, 1);
    assert.equal(app.closes, 1);
  }
});

test("specific time reveals UTC controls and weekday scheduling retains its real meaning", () => {
  const app = harness();
  assert.equal(elements(app.render()).some(node => node.props.id === "flow-wait-time"), false);
  check(app.render(), "Delay until a specific time of day", true);
  assert.equal(elements(app.render()).find(node => node.props.id === "flow-wait-time")!.props.value, "09:00");
  input(app.render(), "flow-wait-time", "15:30");
  check(app.render(), "Count business days only", true);
  click(app.render(), "Save");
  assert.equal(app.config.resumeAt, "15:30");
  assert.equal(app.config.businessDays, true);
  assert.ok(JSON.stringify(app.render()).includes("Time of day (UTC)"));
  const existing = harness(app.config);
  check(existing.render(), "Delay until a specific time of day", false);
  click(existing.render(), "Save");
  assert.equal(existing.config.resumeAt, "");
});

test("invalid edits cannot be saved and show validation feedback", () => {
  for (const amount of ["", "0", "1.5", "525601"]) {
    const app = harness();
    input(app.render(), "flow-wait-amount", amount);
    const tree = app.render();
    assert.equal(button(tree, "Save").props.disabled, true);
    assert.ok(elements(tree).some(node => node.props.role === "alert"));
    click(tree, "Save");
    assert.equal(app.writes, 0);
    assert.equal(app.closes, 0);
  }
});

test("nested delay settings show their path and cannot be changed by viewers", () => {
  const app = harness({ amount: 2, unit: "minutes" }, true, ["Split", "Matches"]);
  const tree = app.render();
  assert.ok(JSON.stringify(tree).includes("Split / Matches"));
  for (const node of elements(tree).filter(node => ["Input", "Checkbox", "Select", "TimePicker"].includes(node.type))) assert.equal(node.props.disabled, true);
  input(tree, "flow-wait-amount", "7");
  check(tree, "Count business days only", true);
  click(app.render(), "Save");
  assert.equal(app.writes, 0);
  assert.equal(control(app.render(), "Delay amount").props.value, "2");
});
