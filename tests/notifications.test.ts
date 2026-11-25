import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: dom.window.requestAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: dom.window.cancelAnimationFrame.bind(dom.window) });
Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false, addListener() {}, removeListener() {} }) });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const sonner = require("sonner") as typeof import("sonner");
const dependencies: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "next-themes": { useTheme: () => ({ resolvedTheme: "dark" }) },
  sonner,
  "lucide-react": require("lucide-react"),
  "./sonner.css": {},
};
const exports = {} as { Toaster: React.ComponentType };
const source = readFileSync(new URL("../components/ui/sonner.tsx", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
const notices = {} as { NotificationToast: React.ComponentType<{ children: React.ReactNode; tone?: "error" | "warning" | "message"; id?: string; preserve?: boolean }> };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/ui/notification-toast.tsx", import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports: notices, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await React.act(() => root.render(React.createElement(exports.Toaster)));
  return { host, async dispose() { await React.act(async () => { sonner.toast.dismiss(); await new Promise(resolve => setTimeout(resolve, 25)); }); await React.act(() => root.unmount()); host.remove(); } };
}

test("all notification types share the global host and can be dismissed", async () => {
  const ui = await mount();
  try {
    await React.act(async () => {
      sonner.toast.message("Message", { duration: Infinity });
      sonner.toast.success("Saved", { duration: Infinity });
      sonner.toast.error("Failed", { duration: Infinity });
      sonner.toast.warning("You can continue", { duration: Infinity });
      await new Promise(resolve => setTimeout(resolve, 25));
    });
    assert.equal(ui.host.querySelectorAll("[data-sonner-toaster]").length, 1);
    assert.equal(ui.host.querySelectorAll('[data-visible="true"]').length, 3);
    assert.ok(ui.host.querySelector(".cn-toast:not([data-type])"));
    for (const type of ["success", "error", "warning"]) {
      assert.ok(ui.host.querySelector(`.cn-toast[data-type="${type}"]`), type);
    }
    const close = ui.host.querySelector<HTMLButtonElement>('[data-type="warning"] [data-close-button]');
    assert.ok(close);
    assert.equal(close.getAttribute("aria-label"), "Close toast");
    await React.act(() => close.click());
    assert.equal(ui.host.querySelector('[data-type="warning"]')?.getAttribute("data-removed"), "true");
  } finally { await ui.dispose(); }
});

test("warning timers pause while the shared stack is hovered and resume afterward", async () => {
  const ui = await mount();
  try {
    await React.act(async () => { sonner.toast.warning("Check the links", { id: "hover-warning" }); await new Promise(resolve => setTimeout(resolve, 25)); });
    const stack = ui.host.querySelector<HTMLOListElement>("[data-sonner-toaster]");
    assert.ok(stack);
    await React.act(() => stack.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 3150)); });
    assert.equal(ui.host.querySelector('[data-type="warning"]')?.getAttribute("data-removed"), "false");
    await React.act(() => stack.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 3150)); });
    assert.equal(ui.host.querySelector('[data-type="warning"]')?.getAttribute("data-removed"), "true");
  } finally { await ui.dispose(); }
});

test("notification actions remain usable and run once", async () => {
  const ui = await mount();
  let calls = 0;
  try {
    await React.act(async () => { sonner.toast.message("Item moved", { duration: Infinity, action: { label: "Undo", onClick() { calls++; } }, cancel: { label: "Dismiss", onClick() {} } }); await new Promise(resolve => setTimeout(resolve, 25)); });
    const action = ui.host.querySelector<HTMLButtonElement>("[data-button]:not([data-cancel])");
    assert.ok(action);
    assert.equal(action.textContent, "Undo");
    await React.act(() => action.click());
    assert.equal(calls, 1);
    assert.equal(ui.host.querySelector('[data-sonner-toast]:last-child')?.getAttribute("data-removed"), "true");
  } finally { await ui.dispose(); }
});

test("state-driven errors use the shared toast without adding an inline banner", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const { NotificationToast } = notices;
  let action = "";
  function render(pending: boolean, currentAction: string, error = true) {
    root.render(React.createElement(React.Fragment, {}, error ? React.createElement(NotificationToast, { id: "save-error" }, "This plan changed in another session.", React.createElement("button", { disabled: pending, onClick() { action = currentAction; } }, "Retry")) : null, React.createElement(exports.Toaster)));
  }
  try {
    await React.act(async () => { render(false, "old"); await new Promise(resolve => setTimeout(resolve, 25)); });
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    assert.equal(host.querySelector('[role="alert"]'), null);
    assert.equal(host.querySelectorAll('[data-sonner-toast]').length, 1);
    assert.match(host.querySelector('[data-type="error"]')?.textContent ?? "", /This plan changed in another session/);
    await React.act(() => render(true, "pending"));
    assert.equal(host.querySelector<HTMLButtonElement>('[data-notification-content] button')?.disabled, true);
    await React.act(() => render(false, "latest"));
    const retry = host.querySelector<HTMLButtonElement>('[data-notification-content] button');
    assert.ok(retry);
    await React.act(() => retry.click());
    assert.equal(action, "latest");
    assert.equal(host.querySelectorAll('[data-sonner-toast]').length, 1);
    await React.act(() => render(false, "corrected", false));
    for (let attempt = 0; attempt < 20 && host.querySelector('[data-type="error"]')?.getAttribute("data-removed") === "false"; attempt++) {
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    }
    assert.equal(host.querySelector('[data-type="error"]')?.getAttribute("data-removed"), "true");
  } finally {
    await React.act(() => root.unmount());
    host.remove();
  }
});

test("identical plain notices share one toast until their final surface clears", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const { NotificationToast } = notices;
  const visible = () => [...host.querySelectorAll('[data-sonner-toast][data-removed="false"]')];
  async function render(first: boolean, second: boolean, text = "Mailbox is temporarily unavailable.", secondText = text) {
    await React.act(async () => {
      root.render(React.createElement(React.Fragment, {},
        first ? React.createElement(NotificationToast, { key: "list", id: "list-error", preserve: true }, text) : null,
        second ? React.createElement(NotificationToast, { key: "reply", id: "reply-error", preserve: true }, secondText) : null,
        React.createElement(exports.Toaster)));
      await new Promise(resolve => setTimeout(resolve, 40));
    });
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  }
  try {
    await render(true, true);
    assert.equal(visible().length, 1);
    assert.equal(host.querySelector("#list-error")?.textContent, "Mailbox is temporarily unavailable.");
    assert.equal(host.querySelector("#reply-error")?.textContent, "Mailbox is temporarily unavailable.");
    await render(false, true);
    assert.equal(visible().length, 1, "closing one surface must not dismiss the other surface's notice");
    await render(false, false);
    assert.equal(visible().length, 0);
    await render(true, true, "A new operation failed.");
    assert.equal(visible().length, 1);
    assert.match(visible()[0].textContent!, /A new operation failed/);
    await render(true, true, "First surface changed.", "A new operation failed.");
    assert.equal(visible().length, 2, "changing one owner must not replace the other owner's toast");
    assert.deepEqual(visible().map(toast => toast.querySelector("[data-notification-content]")?.textContent).sort(), ["A new operation failed.", "First surface changed."]);
    await render(true, false, "First surface changed.");
    assert.equal(visible().length, 1, "clearing the old group must not dismiss the new group");
    assert.match(visible()[0].textContent!, /First surface changed/);
  } finally { await React.act(() => root.unmount()); host.remove(); }
});

test("dismissed shared notices do not return when another surface mounts or rerenders", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  async function render(second: boolean) {
    await React.act(async () => {
      root.render(React.createElement(React.StrictMode, {},
        React.createElement(notices.NotificationToast, { key: "first" }, "Same operation failed."),
        second ? React.createElement(notices.NotificationToast, { key: "second" }, "Same operation failed.") : null,
        React.createElement(exports.Toaster)));
      await new Promise(resolve => setTimeout(resolve, 40));
    });
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  }
  try {
    await render(false);
    const close = host.querySelector<HTMLButtonElement>('[data-sonner-toast][data-removed="false"] [data-close-button]');
    assert.ok(close);
    await React.act(() => close.click());
    await render(true);
    assert.equal(host.querySelectorAll('[data-sonner-toast][data-removed="false"]').length, 0);
  } finally { await React.act(() => root.unmount()); host.remove(); }
});

test("matching errors with different retry actions remain independent", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const actions: string[] = [];
  try {
    await React.act(async () => {
      root.render(React.createElement(React.Fragment, {},
        ...["profile", "reply"].map(name => React.createElement(notices.NotificationToast, { key: name },
          "Unable to save.", React.createElement("button", { onClick: () => actions.push(name) }, `Retry ${name}`))),
        React.createElement(exports.Toaster)));
      await new Promise(resolve => setTimeout(resolve, 40));
    });
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-notification-content] button")];
    assert.equal(buttons.length, 2);
    await React.act(() => { buttons.forEach(button => button.click()); });
    assert.deepEqual(actions.sort(), ["profile", "reply"]);
  } finally { await React.act(() => root.unmount()); host.remove(); }
});
