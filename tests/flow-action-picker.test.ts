import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import ts from "typescript";

type Element = { type: string; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

test("scrolling the action menu never reaches canvas handlers or prevents native list scrolling", () => {
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useState: (value: unknown) => [value, () => {}] },
    "@/components/language-provider": { useLanguage: () => ({ t: (text: string) => text }) },
  };
  const output: Record<string, (props: Record<string, unknown>) => Element> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/flow-action-picker.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: output, require: (name: string) => dependencies[name] || components });
  const tree = output.FlowActionPicker({ items: [], open: true, context: "Main sequence", label: "Add action", disabled: false, onAdd: () => {} });
  const content = elements(tree).find(node => node.type === "PopoverContent")!;
  const dom = new JSDOM('<main><div id="menu"><div id="list"></div></div></main>');
  try {
    let canvasEvents = 0;
    dom.window.document.querySelector("main")!.addEventListener("wheel", () => { canvasEvents++; });
    dom.window.document.getElementById("menu")!.addEventListener("wheel", content.props.onWheel as EventListener);
    for (const ctrlKey of [false, true]) {
      const event = new dom.window.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100, ctrlKey });
      dom.window.document.getElementById("list")!.dispatchEvent(event);
      assert.equal(canvasEvents, 0);
      assert.equal(event.defaultPrevented, false, "The action list must keep its native scrolling");
    }
  } finally { dom.window.close(); }
});
