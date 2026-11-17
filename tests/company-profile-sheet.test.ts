import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://crm.test/companies", pretendToBeVisual: true });
for (const key of ["document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "ShadowRoot", "DocumentFragment", "MutationObserver", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: dom.window.requestAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: dom.window.cancelAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, URL, window: dom.window, require: (name: string) => name.endsWith(".css") ? {} : dependencies[name] ?? require(name) });
  return exports;
}
const sheet = load("components/ui/sheet.tsx", { "@/components/ui/button": { Button: ({ children, ...props }: Record<string, unknown>) => {
  delete props.variant; delete props.size;
  return React.createElement("button", props, children as React.ReactNode);
} } });

async function mount() {
  let backCount = 0;
  const replacements: string[] = [];
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const { CompanyProfileSheet } = load("components/company-profile-sheet.tsx", {
    "@/components/ui/sheet": sheet,
    "next/navigation": { useParams: () => ({ id: "acme" }), useRouter: () => ({ back: () => { backCount++; root.render(null); }, replace: (href: string) => replacements.push(href) }) },
  });
  const render = async (section = "Profile") => {
    await React.act(async () => root.render(React.createElement(CompanyProfileSheet, null,
      React.createElement("input", { "aria-label": "Company name", defaultValue: "Acme" }),
      React.createElement("div", { role: "tabpanel" }, section),
      React.createElement("a", { href: "/companies/acme?tab=purchase-orders&page=2" }, "Next order page"),
    )));
  };
  await render();
  return { render, replacements, backCount: () => backCount, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("company profiles use the workflow-style bottom sheet and retain drafts when server sections change", async () => {
  const ui = await mount();
  try {
    const popup = document.querySelector('[role="dialog"]')!;
    assert.equal(popup.getAttribute("data-side"), "bottom");
    assert.ok(popup.classList.contains("company-profile-sheet"));
    assert.ok(document.querySelector(".company-profile-overlay"));
    assert.equal(document.getElementById(popup.getAttribute("aria-labelledby")!)?.textContent, "Company profile");
    const input = document.querySelector("input")!;
    input.value = "Unsaved company name";
    await ui.render("Email");
    assert.equal(document.querySelector('[role="dialog"]'), popup);
    assert.equal(document.querySelector("input"), input);
    assert.equal(input.value, "Unsaved company name");
    assert.equal(document.querySelector('[role="tabpanel"]')?.textContent, "Email");
    assert.equal(ui.backCount(), 0);
  } finally { await ui.close(); }
});

for (const method of ["close button", "Escape", "backdrop"] as const) test(`${method} closes the profile and returns to the originating history entry once`, async () => {
  const ui = await mount();
  try {
    await React.act(async () => {
      if (method === "close button") document.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')!.click();
      else if (method === "Escape") document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else {
        const overlay = document.querySelector(".company-profile-overlay")!;
        overlay.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
        overlay.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
        overlay.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      }
    });
    assert.equal(ui.backCount(), 1);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await ui.render();
    assert.ok(document.querySelector('[role="dialog"]'), "the popup can reopen after dismissal");
  } finally { await ui.close(); }
});

test("profile pagination replaces the popup entry so closing still returns to the originating page", async () => {
  const ui = await mount();
  try {
    await React.act(async () => document.querySelector<HTMLAnchorElement>("a")!.click());
    assert.deepEqual(ui.replacements, ["/companies/acme?tab=purchase-orders&page=2"]);
    assert.equal(ui.backCount(), 0);
  } finally { await ui.close(); }
});
