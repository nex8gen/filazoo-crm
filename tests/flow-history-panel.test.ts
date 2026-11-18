import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/workflow", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const source = ts.createSourceFile("flow-builder.tsx", readFileSync(new URL("../components/flow-builder.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function builderKey(name: string, draft: { id: string | null }) {
  let expression: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === name) {
      const key = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(source) === "key");
      if (key && ts.isJsxAttribute(key) && key.initializer && ts.isJsxExpression(key.initializer)) expression = key.initializer.expression?.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `Missing ${name} identity in the actual builder`);
  return vm.runInNewContext(expression, { draft }) as string;
}

const output = {} as typeof import("../components/flow-history-panel.tsx");
const Element = ({ children, ...props }: Record<string, unknown>) => React.createElement("div", Object.fromEntries(Object.entries(props).filter(([key]) => !["value", "variant", "onValueChange"].includes(key))), children as React.ReactNode);
const Button = ({ children, ...props }: Record<string, unknown>) => React.createElement("button", Object.fromEntries(Object.entries(props).filter(([key]) => !["variant", "size", "value"].includes(key))), children as React.ReactNode);
const dependencies: Record<string, unknown> = {
  "@/components/ui/button": { Button },
  "@/components/ui/input": { Input: (props: object) => React.createElement("input", props) },
  "@/components/ui/tabs": { Tabs: Element, TabsContent: Element, TabsList: Element, TabsTrigger: Button },
};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/flow-history-panel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports: output, window: dom.window, AbortController, fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args), require: (name: string) => dependencies[name] ?? require(name) });

test("closing and reopening flow history removes its DOM, aborts pending reads, and preserves the canvas", async () => {
  for (const id of ["11111111-1111-4111-8111-111111111111", null]) {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const oldFetch = globalThis.fetch, oldError = console.error;
    const warnings: unknown[][] = [];
    const requests: AbortSignal[] = [];
    let ready = false;
    console.error = (...args: unknown[]) => { warnings.push(args); };
    globalThis.fetch = (async (_input, init) => {
      if (init?.signal) requests.push(init.signal);
      return ready ? Response.json({ ok: true, entries: [], hasMore: false }) : new Promise<Response>(() => {});
    }) as typeof fetch;
    function Canvas() { return React.createElement("main", { "data-canvas": "true" }, "Canvas"); }
    function Fixture() {
      const [open, setOpen] = React.useState(false);
      const button = React.useRef<HTMLButtonElement>(null);
      const close = () => { setOpen(false); button.current?.focus(); };
      return React.createElement(React.Fragment, null,
        React.createElement("button", { ref: button, "aria-label": "Flow history", "aria-expanded": open, onClick: () => setOpen(value => !value) }, "History"),
        React.createElement("div", { className: "wf-workbench" },
          React.createElement("div", { "data-flow-canvas-safe-area": true }),
          open ? React.createElement(output.FlowHistoryPanel, { key: builderKey("FlowHistoryPanel", { id }), id: "history", flowId: id, onClose: close }) : null,
          React.createElement(Canvas, { key: builderKey("FlowCanvas", { id }) })));
    }
    const click = async (label: string) => {
      const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      assert.ok(button);
      await React.act(async () => button.click());
    };
    try {
      await React.act(async () => root.render(React.createElement(Fixture)));
      const canvas = host.querySelector("[data-canvas]");
      for (const mode of ["loading", "loaded", "escape", "toggle"]) {
        ready = mode !== "loading";
        await click("Flow history");
        await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
        assert.equal(host.querySelectorAll(".wf-history-panel").length, 1, "Only one panel may exist after reopening");
        if (mode === "escape") {
          await React.act(async () => host.querySelector("aside")!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        } else await click(mode === "toggle" ? "Flow history" : "Close flow history");
        assert.equal(host.querySelectorAll(".wf-history-panel").length, 0, "Closing must remove the panel, not just change toolbar state");
        assert.equal(host.querySelector("[data-canvas]"), canvas, "The canvas must retain its DOM and state");
        assert.equal(host.querySelector('[aria-label="Flow history"]')?.getAttribute("aria-expanded"), "false");
        if (mode !== "toggle") assert.equal(document.activeElement, host.querySelector('[aria-label="Flow history"]'));
        assert.ok(requests.every(signal => signal.aborted), "Closing must cancel every pending history read");
      }
      assert.deepEqual(warnings, [], "Opening/closing must not emit duplicate-key or reconciliation errors");
    } finally {
      globalThis.fetch = oldFetch; console.error = oldError;
      await React.act(async () => root.unmount()); host.remove();
    }
  }
});
