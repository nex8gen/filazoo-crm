import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/workflow" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);

test("template cards are styled on first library load and thumbnail scaling follows each card's width", async () => {
  let width = 200, designerLoads = 0;
  const observers = new Set<() => void>();
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return width; } });
  class ResizeObserver {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe() { observers.add(this.callback); }
    disconnect() { observers.delete(this.callback); }
  }
  const container = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const button = ({ children, ...props }: Record<string, unknown>) => { delete props.variant; delete props.size; return React.createElement("button", props, children as React.ReactNode); };
  const templates = ["one", "two"].map(id => ({ id, name: `Saved template ${id}`, subject: "Welcome", body: "Hello", updated_at: "2026-11-13T00:00:00Z", preview_url: `/preview/${id}` }));
  const dependencies: Record<string, unknown> = {
    "next/dynamic": { default: () => () => { designerLoads++; return null; } },
    "@/components/ui/button": { Button: button }, "@/components/ui/input": { Input: (props: Record<string, unknown>) => React.createElement("input", props) },
    "@/components/ui/textarea": { Textarea: (props: Record<string, unknown>) => React.createElement("textarea", props) },
    "@/components/ui/notification-toast": { NotificationToast: container },
    "@/components/ui/dropdown-menu": { DropdownMenu: container, DropdownMenuTrigger: ({ render }: { render: React.ReactNode }) => render, DropdownMenuContent: () => null, DropdownMenuItem: container },
    "@/components/ui/dialog": { Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null, DialogContent: container, DialogHeader: container, DialogTitle: container, DialogDescription: container, DialogFooter: container },
    "@/components/use-document-library": { useDocumentLibrary: () => ({ data: { documents: templates, total: 2 }, loading: false }) },
    "@/lib/email-campaigns": {}, "@/lib/campaign-message-tools": {}, "@/lib/email-design": {}, "@/lib/documents": { isBuiltinEmailTemplate: () => false }, "@/lib/campaign-editor-session": {},
  };
  const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/campaign-template-library.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let cssLoads = 0;
  vm.runInNewContext(code, { exports, ResizeObserver, URLSearchParams, require: (name: string) => {
    if (name === "./campaign-template-library.css") { const style = document.createElement("style"); style.textContent = readFileSync(new URL("../components/campaign-template-library.css", import.meta.url), "utf8"); document.head.append(style); cssLoads++; return {}; }
    if (name.startsWith("@/") || name === "next/dynamic") return dependencies[name];
    return require(name);
  } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(React.createElement(exports.CampaignTemplateLibrary, { canWrite: true, selectedId: null, body: "", subject: "", name: "Email", products: [], sessionKey: "test", recoverDesigner: false })));
    assert.equal(cssLoads, 1); assert.equal(designerLoads, 0);
    const cards = [...host.querySelectorAll<HTMLElement>(".campaign-builder-templateCard")];
    assert.equal(cards.length, 2);
    assert.equal(parseFloat(dom.window.getComputedStyle(cards[0]).minWidth), 0);
    assert.equal(dom.window.getComputedStyle(cards[0]).overflow, "hidden");
    assert.equal(dom.window.getComputedStyle(host.querySelector(".campaign-builder-templateMenu")!).position, "absolute");
    const paper = host.querySelector<HTMLElement>(".campaign-builder-templatePaper")!;
    assert.equal(Number(paper.style.getPropertyValue("--template-preview-scale")), 200 / 600);
    assert.equal(dom.window.getComputedStyle(paper.querySelector("iframe")!).pointerEvents, "none");
    width = 280;
    await React.act(async () => observers.forEach(notify => notify()));
    assert.equal(Number(paper.style.getPropertyValue("--template-preview-scale")), 280 / 600);
  } finally { await React.act(async () => root.unmount()); host.remove(); dom.window.close(); }
});
