import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Element = { type: string; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children), ...elements(element.props.render)];
}
function harness(initial: string, disabled = false) {
  let value = initial, writes = 0, open = false;
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useState: () => [open, (next: boolean) => { open = next; }] },
    cn: { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
  };
  const output: Record<string, (props: Record<string, unknown>) => Element> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/ui/time-picker.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: output, require: (name: string) => dependencies[name] || components });
  const render = () => output.TimePicker({ value, disabled, id: "resume-time", "aria-label": "Time of day (UTC)", onValueChange: (next: string) => { value = next; writes++; } });
  return { render, get value() { return value; }, get writes() { return writes; } };
}
function select(tree: Element, index: number, value: string | null) {
  (elements(tree).filter(node => node.type === "Select")[index].props.onValueChange as (value: string | null) => void)(value);
}

test("shared time picker preserves 24-hour values without timezone conversion", () => {
  const app = harness("23:59");
  const tree = app.render();
  assert.equal(elements(tree).find(node => node.props.id === "resume-time")!.props["aria-label"], "Time of day (UTC)");
  assert.equal(elements(tree).some(node => node.type === "input" || node.type === "Input"), false);
  assert.equal(elements(tree).filter(node => node.type === "SelectItem").length, 84);
  select(tree, 0, "00");
  assert.equal(app.value, "00:59");
  select(app.render(), 1, "00");
  assert.equal(app.value, "00:00");
  select(app.render(), 0, "12");
  assert.equal(app.value, "12:00");
});

test("empty times remain empty until chosen and disabled pickers cannot write", () => {
  const empty = harness("");
  empty.render();
  assert.equal(empty.writes, 0);
  select(empty.render(), 1, "15");
  assert.equal(empty.value, "00:15");
  select(empty.render(), 0, null);
  assert.equal(empty.writes, 1);
  const viewer = harness("09:30", true);
  const tree = viewer.render();
  (tree.props.onOpenChange as (value: boolean) => void)(true);
  assert.equal(viewer.render().props.open, false);
  assert.ok(elements(tree).filter(node => node.type === "Select").every(node => node.props.disabled === true));
  select(tree, 0, "10");
  select(tree, 1, "45");
  assert.equal(viewer.value, "09:30");
  assert.equal(viewer.writes, 0);
});
