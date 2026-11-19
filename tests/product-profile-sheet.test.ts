import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://crm.test/products", pretendToBeVisual: true });
for (const key of ["document", "navigator", "HTMLElement", "HTMLInputElement", "SVGElement", "Element", "Node", "NodeFilter", "ShadowRoot", "DocumentFragment", "MutationObserver", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: dom.window.requestAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: dom.window.cancelAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name.endsWith(".css") ? {} : dependencies[name] ?? require(name) });
  return exports as T;
}
const sheet = load("components/ui/sheet.tsx", { "@/components/ui/button": { Button: ({ children, ...props }: Record<string, unknown>) => {
  delete props.variant; delete props.size;
  return React.createElement("button", props, children as React.ReactNode);
} } });

async function mount(returnToCatalog = false) {
  let backCount = 0;
  const replacements: { href: string; scroll?: boolean }[] = [];
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const profile = load<typeof import("../components/product-profile-sheet.tsx")>("components/product-profile-sheet.tsx", {
    "@/lib/motion-features": { default: require("motion/react").domAnimation },
    "@/components/ui/sheet": sheet,
    "next/navigation": { useRouter: () => ({
      back: () => { backCount++; root.render(null); },
      replace: (href: string, options: { scroll?: boolean }) => { replacements.push({ href, ...options }); root.render(null); },
    }) },
  });
  function Fields({ busy }: { busy: boolean }) {
    const panel = profile.useProductProfileSheet()!;
    React.useEffect(() => { panel.setBusy(busy); }, [busy, panel]);
    return React.createElement(React.Fragment, null,
      React.createElement("input", { "aria-label": "Product name", defaultValue: "Basic PLA" }),
      React.createElement("button", { "data-editor-close": true, onClick: panel.close }, "Close product"),
    );
  }
  async function render(busy = false) {
    await React.act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement("div", { "data-product-list": true }, "Products list with its filters and selected rows"),
      React.createElement(profile.ProductProfileSheet, { returnToCatalog }, React.createElement(Fields, { busy })),
    )));
  }
  await render();
  return { render, backCount: () => backCount, replacements, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("product profiles keep the catalog mounted and retain form values across rerenders", async () => {
  const ui = await mount();
  try {
    const list = document.querySelector("[data-product-list]");
    const popup = document.querySelector('[role="dialog"]')!;
    assert.equal(popup.getAttribute("data-side"), "right");
    assert.ok(popup.classList.contains("product-profile-sheet"));
    assert.equal(document.getElementById(popup.getAttribute("aria-labelledby")!)?.textContent, "Product details");
    assert.ok(document.getElementById(popup.getAttribute("aria-labelledby")!)?.classList.contains("sr-only"));
    assert.equal(popup.querySelector('[data-slot="sheet-header"]'), null);
    assert.equal(popup.querySelector('[data-slot="sheet-close"]'), null);
    const input = document.querySelector("input")!;
    input.value = "Unsaved product name";
    await ui.render();
    assert.equal(document.querySelector("[data-product-list]"), list);
    assert.equal(document.querySelector('[role="dialog"]'), popup);
    assert.equal(document.querySelector("input"), input);
    assert.equal(input.value, "Unsaved product name");
    assert.equal(ui.backCount(), 0);
  } finally { await ui.close(); }
});

for (const returnToCatalog of [false, true]) for (const method of ["editor close", "Escape", "backdrop"] as const) test(`${method} closes the ${returnToCatalog ? "reloaded" : "intercepted"} product panel and returns to the catalog`, async () => {
  const ui = await mount(returnToCatalog);
  try {
    await React.act(async () => {
      if (method === "editor close") document.querySelector<HTMLButtonElement>("[data-editor-close]")!.click();
      else if (method === "Escape") document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else {
        const overlay = document.querySelector(".product-profile-overlay")!;
        for (const type of ["mousedown", "mouseup", "click"]) overlay.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true }));
      }
    });
    assert.equal(ui.backCount(), returnToCatalog ? 0 : 1);
    assert.deepEqual(ui.replacements, returnToCatalog ? [{ href: "/products", scroll: false }] : []);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await ui.render();
    assert.ok(document.querySelector('[role="dialog"]'), "product details can reopen after dismissal");
  } finally { await ui.close(); }
});

for (const returnToCatalog of [false, true]) test(`the ${returnToCatalog ? "reloaded" : "intercepted"} panel cannot close while a product save or image upload is busy`, async () => {
  const ui = await mount(returnToCatalog);
  try {
    await ui.render(true);
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-editor-close]')!.click());
    assert.equal(ui.backCount(), 0);
    assert.equal(ui.replacements.length, 0);
    await React.act(async () => document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(ui.backCount(), 0);
    assert.equal(ui.replacements.length, 0);
    assert.ok(document.querySelector('[role="dialog"]'));
    await ui.render(false);
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-editor-close]')!.click());
    assert.equal(ui.backCount(), returnToCatalog ? 0 : 1);
    assert.deepEqual(ui.replacements, returnToCatalog ? [{ href: "/products", scroll: false }] : []);
  } finally { await ui.close(); }
});
