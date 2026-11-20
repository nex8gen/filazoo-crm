import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { isCompanyProfilePath } from "../lib/company-tabs.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://crm.test/companies", pretendToBeVisual: true });
for (const key of ["document", "navigator", "HTMLElement", "HTMLInputElement", "SVGElement", "Element", "Node", "NodeFilter", "ShadowRoot", "DocumentFragment", "MutationObserver", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
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

async function finishCloseAnimation() {
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
}

async function mount(closeHref?: string, backgroundHref?: string, initialSegment?: string, reducedMotion = false) {
  let backCount = 0;
  const replacements: string[] = [];
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const CompanyProfileReturnContext = React.createContext<string | undefined>(undefined);
  let segment = initialSegment;
  let pathname = "/companies/acme";
  const { CompanyProfileSheet } = load("components/company-profile-sheet.tsx", {
    "motion/react": { ...require("motion/react"), useReducedMotion: () => reducedMotion },
    "@/lib/motion-features": { default: require("motion/react").domAnimation },
    "@/components/ui/sheet": sheet,
    "@/components/company-profile-navigation": { CompanyProfileReturnContext },
    "next/navigation": { useParams: () => ({ id: "acme" }), useRouter: () => ({ back: () => { backCount++; root.render(null); }, replace: (href: string) => replacements.push(href) }) },
  });
  const { default: CompanyProfileSlot } = load("app/@company/layout.tsx", {
    "@/components/company-profile-sheet": { CompanyProfileSheet },
    "next/navigation": { useSelectedLayoutSegment: () => segment, usePathname: () => pathname },
    "@/lib/company-tabs": { isCompanyProfilePath },
  });
  const render = async (section = "Profile") => {
    await React.act(async () => root.render(React.createElement(CompanyProfileReturnContext, { value: backgroundHref }, React.createElement(initialSegment ? CompanyProfileSlot : CompanyProfileSheet, { closeHref },
      React.createElement("input", { "aria-label": "Company name", defaultValue: "Acme" }),
      React.createElement("div", { role: "tabpanel" }, section),
      React.createElement("a", { href: "/companies/acme?tab=purchase-orders&page=2" }, "Next order page"),
    ))));
  };
  await render();
  return { render, visit: async (next: string) => { pathname = next; await render(); }, navigate: async (next: string, section: string) => { segment = next; await render(section); }, replacements, backCount: () => backCount, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("the lazy-loaded drawer slides in from the right and does not replay when changing sections", async () => {
  const ui = await mount();
  try {
    const popup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    assert.match(popup.style.transform, /translateX\(/, "the drawer starts offset to the right");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
    assert.equal(popup.style.transform, "none", "the animation finishes in the resting position");
    await ui.render("Email");
    assert.equal(document.querySelector('[role="dialog"]'), popup);
    assert.equal(popup.style.transform, "none", "tab navigation does not restart the entrance");
  } finally { await ui.close(); }
});

test("company profiles use a right-side drawer and retain drafts when server sections change", async () => {
  const ui = await mount();
  try {
    const popup = document.querySelector('[role="dialog"]')!;
    assert.equal(popup.getAttribute("data-side"), "right");
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
    await finishCloseAnimation();
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

for (const method of ["close button", "Escape", "backdrop"] as const) test(`${method} returns a directly loaded profile to companies without leaving the app`, async () => {
  const ui = await mount("/companies");
  try {
    await React.act(async () => {
      if (method === "close button") document.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')!.click();
      else if (method === "Escape") document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else {
        const overlay = document.querySelector(".company-profile-overlay")!;
        for (const type of ["mousedown", "mouseup", "click"]) overlay.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true }));
      }
    });
    await finishCloseAnimation();
    assert.deepEqual(ui.replacements, ["/companies"]);
    assert.equal(ui.backCount(), 0);
    assert.equal(document.querySelector('[role="dialog"]'), null, "dismiss after the exit animation even while router navigation is pending");
  } finally { await ui.close(); }
});

test("a refreshed profile still closes to its company-list background after intercepted tab navigation", async () => {
  const ui = await mount(undefined, "/companies");
  try {
    await React.act(async () => document.querySelector<HTMLAnchorElement>("a")!.click());
    await ui.render("Purchase orders");
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')!.click());
    await finishCloseAnimation();
    assert.deepEqual(ui.replacements, ["/companies/acme?tab=purchase-orders&page=2", "/companies"]);
    assert.equal(ui.backCount(), 0);
  } finally { await ui.close(); }
});

test("the first tab change after reload retains the same drawer without replaying its entrance", async () => {
  const ui = await mount(undefined, "/companies", "companies");
  try {
    const popup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
    assert.equal(popup.style.transform, "none");
    await ui.navigate("(.)companies", "Email");
    assert.equal(document.querySelector('[role="dialog"]'), popup);
    assert.equal(popup.style.transform, "none");
    assert.equal(document.querySelector('[role="tabpanel"]')?.textContent, "Email");
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')!.click());
    await finishCloseAnimation();
    assert.deepEqual(ui.replacements, ["/companies"]);
  } finally { await ui.close(); }
});

test("a retained company slot disappears on the list and can reopen for a company", async () => {
  const ui = await mount(undefined, "/companies", "companies");
  try {
    await ui.visit("/companies");
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await ui.render("Retained server content");
    assert.equal(document.querySelector('[role="dialog"]'), null, "a server refresh cannot reopen the drawer on the list");
    await ui.visit("/companies/acme");
    assert.ok(document.querySelector('[role="dialog"]'));
  } finally { await ui.close(); }
});

test("closing keeps the drawer mounted for its slide-out, then navigates only once", async () => {
  const ui = await mount("/companies");
  try {
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
    const popup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')!.click());
    assert.equal(document.querySelector('[role="dialog"]'), popup, "keep the panel visible while it exits");
    assert.deepEqual(ui.replacements, [], "do not change routes before the exit finishes");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    assert.match(popup.style.transform, /translateX\(/, "slide towards the right while closing");
    await finishCloseAnimation();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.deepEqual(ui.replacements, ["/companies"]);
  } finally { await ui.close(); }
});

test("reduced motion skips sliding and closes without waiting for the animated duration", async () => {
  const ui = await mount("/companies", undefined, undefined, true);
  try {
    assert.doesNotMatch(document.querySelector<HTMLElement>('[role="dialog"]')!.style.transform, /translateX\(/);
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')!.click());
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.deepEqual(ui.replacements, ["/companies"]);
  } finally { await ui.close(); }
});
