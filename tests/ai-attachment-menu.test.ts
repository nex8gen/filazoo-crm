import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as imageInput from "../lib/ai/image-input.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "ShadowRoot", "HTMLInputElement"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);

const zIndex = (element: Element) => Math.max(0, ...Array.from(element.classList).map(name => Number(/^z-(?:\[(\d+)\]|(\d+))$/.exec(name)?.slice(1).find(Boolean) ?? 0)));
const sidebarSource = readFileSync(new URL("../components/workspace-ai-assistant.tsx", import.meta.url), "utf8");
const sidebarLayer = Number(/fixed inset-y-0 right-0 z-\[(\d+)\]/.exec(sidebarSource)?.[1]);

async function mount() {
  const libraryFiles = Array.from({ length: 6 }, (_, index) => ({ id: `file-${index}`, name: `notes-${index}.txt`, mime_type: "text/plain", size: 5 }));
  let fileDialogs = 0;
  const added: unknown[] = [];
  const requested: string[] = [];
  const modules = new Map<string, Record<string, unknown>>();
  const load = (file: string): Record<string, unknown> => {
    if (modules.has(file)) return modules.get(file)!;
    const exports: Record<string, unknown> = {};
    modules.set(file, exports);
    const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { exports, document, window: dom.window, AbortController, URLSearchParams, setTimeout, clearTimeout,
      fetch: async (url: string) => { requested.push(url); return Response.json({ documents: libraryFiles, total: libraryFiles.length }); },
      require: (name: string) => {
        if (name === "next/dynamic") return { default: () => load("components/ui/ai-library-picker.tsx").default };
        if (name === "@/lib/ai/image-input") return imageInput;
        if (name.startsWith("@/lib/ai/")) return {};
        if (name === "@/components/ui/notification-toast") return { NotificationToast: () => null };
        if (name.startsWith("@/components/ui/")) return load(`${name.slice(2)}.tsx`);
        return require(name);
      },
    });
    return exports;
  };
  const { AiImagePicker } = load("components/ui/ai-image-attachments.tsx");
  const host = document.createElement("aside"); host.className = `fixed z-[${sidebarLayer}]`; document.body.append(host);
  const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(AiImagePicker as React.ComponentType<unknown>, { attachments: {
    images: [], files: [], processing: false, add: async () => true,
    addLibrary: async (files: unknown[]) => { added.push(...files); return true; },
  } })));
  host.querySelector("input[type=file]")!.addEventListener("click", event => { event.preventDefault(); fileDialogs++; });
  const open = async () => {
    const trigger = host.querySelector<HTMLButtonElement>("[aria-label='Attach files and images']")!;
    await React.act(async () => trigger.click());
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    const menu = document.querySelector("[data-slot=dropdown-menu-content]")!;
    assert.ok(menu, "the real menu is mounted after clicking Add files");
    assert.ok(zIndex(menu.parentElement!) > sidebarLayer, "the portalled menu must appear above the AI sidebar");
    return menu;
  };
  const choose = async (menu: Element, text: string) => {
    const item = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")].find(node => node.textContent?.includes(text));
    assert.ok(item, text); await React.act(async () => item.click());
  };
  return { host, open, choose, added, requested, fileDialogs: () => fileDialogs, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("Add files opens above the sidebar and its upload action invokes the native file picker", async () => {
  const ui = await mount();
  try { await ui.choose(await ui.open(), "Add photos & files"); assert.equal(ui.fileDialogs(), 1); }
  finally { await ui.close(); }
});

test("the library dialog stays above the sidebar, loads files and attaches up to five selections", async () => {
  const ui = await mount();
  try {
    await ui.choose(await ui.open(), "Add from library");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    const dialog = document.querySelector("[data-slot=dialog-content]")!;
    const overlay = document.querySelector("[data-slot=dialog-overlay]")!;
    assert.ok(zIndex(overlay) > sidebarLayer); assert.ok(zIndex(dialog) > zIndex(overlay));
    assert.match(ui.requested[0], /attachable=1/);
    const choices = [...dialog.querySelectorAll<HTMLButtonElement>("[role=checkbox]")];
    assert.equal(choices.length, 6);
    for (const choice of choices.slice(0, 5)) await React.act(async () => choice.click());
    assert.equal(choices[5].disabled, true);
    const add = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Add (5)")!;
    await React.act(async () => add.click());
    assert.equal(ui.added.length, 5); assert.equal(document.querySelector("[data-slot=dialog-content]"), null);
  } finally { await ui.close(); }
});
