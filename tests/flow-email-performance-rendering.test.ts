import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as performance from "../lib/flow-email-performance.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/workflow", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "HTMLButtonElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "MutationObserver", "DOMRect", "getComputedStyle"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: dom.window.requestAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: dom.window.cancelAnimationFrame.bind(dom.window) });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);

test("mounted performance controls load real totals, open the actual status menu, recover errors and clear stale workflow data", async () => {
  const modules = new Map<string, Record<string, unknown>>();
  let mode: "ready" | "error" | "empty" | "pending" = "ready", requests = 0;
  const changes: string[] = [];
  const load = (file: string): Record<string, unknown> => {
    if (modules.has(file)) return modules.get(file)!;
    const exports: Record<string, unknown> = {}; modules.set(file, exports);
    const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { exports, window: dom.window, document, AbortController, console, require: (name: string) => name === "@/lib/flow-email-performance" ? performance : name.startsWith("@/components/ui/") ? load(`../components/ui/${name.split("/").at(-1)}.tsx`) : require(name), fetch: async (_url: string, init: { signal: AbortSignal }) => {
      requests++;
      if (mode === "pending") return new Promise((_resolve, reject) => { init.signal.addEventListener("abort", () => reject(new Error("aborted"))); });
      if (mode === "error") return Response.json({ ok: false, error: "Temporary query failure" }, { status: 503 });
      return Response.json({ ok: true, report: { asOf: "2026-11-17T12:00:00Z", from: "2026-10-19T00:00:00Z", actions: mode === "empty" ? {} : { email: { sent: 13, opens: 7, clicks: 1, openRate: 7 / 13 * 100, clickRate: 1 / 13 * 100, waiting: 2, review: 1, skipped: 3 } } } });
    } });
    return exports;
  };
  const controls = load("../components/flow-email-performance.tsx") as unknown as typeof import("../components/flow-email-performance.tsx");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let version = 0;
  const render = async (flowId = "one", status: "live" | "draft" = "live", disabled = false, reportsVisible = true) => {
    await React.act(async () => root.render(React.createElement(controls.FlowEmailPerformanceProvider, { flowId, status, reportsVisible, version: String(++version), savedIds: ["email"], disabled, onEmailStatusChange: (_id, value) => changes.push(value) }, React.createElement(React.Fragment, null, React.createElement(controls.FlowEmailMetrics, { actionId: "email" }), React.createElement(controls.FlowEmailMetrics, { actionId: "email", card: true }), React.createElement(controls.FlowEmailStatus, { status, disabled, onChange: value => changes.push(value) })))));
  };
  try {
    await render("one", "live", false, false);
    assert.equal(requests, 0, "Hidden reports must not load performance");
    await render();
    assert.match(host.textContent!, /53\.8% \(7\)/); assert.match(host.textContent!, /7\.7% \(1\)/);
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label^="Email status"]')!;
    await React.act(async () => trigger.click());
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    assert.deepEqual(items.map(node => node.textContent), ["Draft", "Live"]);
    await React.act(async () => items[0].click());
    assert.deepEqual(changes, ["draft"]);
    mode = "error"; await render();
    assert.match(host.textContent!, /Performance unavailable/); assert.doesNotMatch(host.textContent!, /53\.8%/);
    mode = "ready";
    await React.act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Retry email performance"]')!.click());
    assert.match(host.textContent!, /53\.8% \(7\)/);
    mode = "empty"; await render();
    assert.match(host.textContent!, /No sends recorded/);
    mode = "pending"; await render("two");
    assert.match(host.textContent!, /Loading performance/); assert.doesNotMatch(host.textContent!, /53\.8%/);
    const before = requests;
    await render("two", "draft", true);
    assert.equal(requests, before, "Draft workflows must not request live analytics");
    assert.equal(host.querySelector<HTMLButtonElement>('button[aria-label^="Email status"]')!.disabled, true);
    await render("two", "live", false, false);
    assert.equal(requests, before, "Hidden reports must not start background loading");
    mode = "ready"; await render("two");
    assert.equal(requests, before + 1, "Showing reports refreshes their data");
  } finally { await React.act(async () => root.unmount()); host.remove(); dom.window.close(); }
});
