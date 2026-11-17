import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as recipes from "../lib/flow-recipes.ts";
import * as flows from "../lib/flows.ts";
import * as tree from "../lib/flow-tree.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://crm.test/workflow", pretendToBeVisual: true });
for (const key of ["document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "ShadowRoot", "DocumentFragment", "MutationObserver", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: dom.window.requestAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: dom.window.cancelAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
function native(tag: string) {
  return function Control({ children, ...props }: Record<string, unknown>) {
    delete props.variant; delete props.size;
    return React.createElement(tag, props, children as React.ReactNode);
  };
}
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name.endsWith(".css") ? {} : dependencies[name] ?? require(name) });
  return exports;
}
const controls = { "@/components/ui/button": { Button: native("button") }, "@/components/ui/input": { Input: native("input") }, "@/components/ui/badge": { Badge: native("span") } };
const sheet = load("components/ui/sheet.tsx", controls);
const { FlowStarterDialog } = load("components/flow-starter-dialog.tsx", { ...controls, "@/components/ui/sheet": sheet, "@/lib/flow-recipes": recipes, "@/lib/flow-tree": tree, "@/lib/flows": flows, "@/components/language-provider": { useLanguage: () => ({ t: (text: string) => text }) } });

async function mount() {
  const choices: flows.FlowInput[] = [];
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  function Picker() {
    const [open, setOpen] = React.useState(true);
    return open ? React.createElement(FlowStarterDialog, { viewerId: "alice", onOpenChange: setOpen, onChoose: (flow: flows.FlowInput) => { choices.push(flow); setOpen(false); } }) : null;
  }
  await React.act(async () => root.render(React.createElement(Picker)));
  const search = async (value: string) => {
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  };
  const click = async (selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(selector); assert.ok(button, selector);
    await React.act(async () => button.click());
  };
  return { choices, search, click, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("create workflow uses a bottom sheet with template previews, a leading scratch option, and a working close button", async () => {
  const ui = await mount();
  try {
    const popup = document.querySelector('[role="dialog"]')!;
    assert.equal(popup.getAttribute("data-side"), "bottom");
    assert.ok(document.querySelector('[data-slot="sheet-overlay"].flow-starter-overlay'));
    assert.equal(document.querySelectorAll(".flow-starter-card").length, recipes.flowRecipeOptions.length);
    assert.equal(document.querySelectorAll(".flow-starter-preview").length, recipes.flowRecipeOptions.length);
    assert.ok(document.querySelector(".flow-starter-preview-branches"));
    assert.ok(document.querySelector(".flow-starter-preview-trigger")?.textContent?.includes("New lead"));
    const scratch = document.querySelector(".flow-starter-scratch")!;
    const search = document.querySelector('input[type="search"]')!;
    assert.ok(scratch.compareDocumentPosition(search) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    await ui.click('[data-slot="sheet-close"]');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(ui.choices.length, 0);
  } finally { await ui.close(); }
});

test("search filters templates by name, trigger and action and recovers from no results", async () => {
  const ui = await mount();
  try {
    await ui.search("SHOPIFY");
    assert.equal(document.querySelectorAll(".flow-starter-card").length, 1);
    assert.ok(document.querySelector(".flow-starter-card h3")?.textContent?.includes("Shopify"));
    await ui.search("Email received");
    assert.equal(document.querySelectorAll(".flow-starter-card").length, 1);
    await ui.search("Create CRM task");
    assert.ok(document.querySelectorAll(".flow-starter-card").length > 1);
    await ui.search("no-such-recipe");
    assert.equal(document.querySelectorAll(".flow-starter-card").length, 0);
    assert.ok(document.querySelector(".flow-starter-empty")?.textContent?.includes("No matching workflows"));
    assert.ok(document.querySelector(".flow-starter-scratch"));
    await ui.click(".flow-starter-empty button");
    assert.equal(document.querySelectorAll(".flow-starter-card").length, recipes.flowRecipeOptions.length);
  } finally { await ui.close(); }
});

test("scratch and templates open independent drafts, with personal handoff assigned to the current user", async () => {
  const scratch = await mount();
  try {
    await scratch.click(".flow-starter-scratch");
    assert.equal(scratch.choices[0].status, "draft");
    assert.equal(scratch.choices[0].steps.length, 0);
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally { await scratch.close(); }
  const chosen: flows.FlowInput[] = [];
  for (let i = 0; i < 2; i++) {
    const ui = await mount();
    try {
      await ui.click('.flow-starter-card[aria-label="AI lead reply and personal handoff"]');
      chosen.push(ui.choices[0]);
      assert.equal(chosen[i].status, "draft");
      const tasks = tree.flowActionLocations(chosen[i].steps).filter(({ action }) => action.type === "create_task");
      assert.ok(tasks.length > 0); assert.ok(tasks.every(({ action }) => action.config.assigneeId === "alice"));
    } finally { await ui.close(); }
  }
  assert.notEqual(chosen[0].steps[0].id, chosen[1].steps[0].id);
});
