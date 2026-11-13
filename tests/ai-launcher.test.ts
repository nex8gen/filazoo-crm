import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { getPageAiPrompts } from "../lib/page-ai-prompts.ts";
import { translateUiText } from "../lib/i18n.ts";

const dom = new JSDOM("<!doctype html><body><button id='outside'>Outside</button></body>", { url: "https://crm.test/email" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);

test("page prompts resolve specific sections, records, and unrelated route prefixes correctly", () => {
  const routes = [
    ["/email", "Email"], ["/email/campaigns?year=2026", "Marketing campaigns"], ["/email/workflows", "Workflow"],
    ["/workflow/qa", "Workflow"], ["/automation", "Workflow"], ["/companies/", "Companies"],
    ["/companies/customer-1", "Company profile"], ["/products/PLA-BLACK", "Products"],
    ["/purchase-orders/drafts", "Purchase Order"], ["/invoices/invoice-1", "Invoices"],
    ["/company-quotations/quote-1", "Company Quotations"], ["/segments", "Segments"],
    ["/lead-channel/ai-leads", "AI Leads"], ["/documents", "Files & templates"], ["/messenger", "Messenger"],
    ["/analytics", "Analytics"], ["/tasks", "Tasks and notifications"], ["/pipeline", "Pipeline"],
    ["/settings/apps", "Settings"], ["/emailing", "Workspace"],
  ];
  for (const [route, page] of routes) {
    const result = getPageAiPrompts(route);
    assert.equal(result.page, page, route);
    assert.equal(result.prompts.length, 4);
    assert.equal(new Set(result.prompts.map(item => item.id)).size, 4);
    assert.deepEqual(result.prompts.map(item => item.mode), ["chat", "chat", "agent", "agent"]);
    for (const prompt of result.prompts) {
      assert.notEqual(translateUiText(prompt.label, "zh-CN"), prompt.label, prompt.label);
      assert.ok(prompt.icon);
      assert.ok(prompt.prompt.length < 6000);
      assert.match(prompt.prompt, prompt.mode === "chat" ? /read-only/ : /for review/);
    }
  }
  assert.match(getPageAiPrompts("/email").prompts[2].prompt, /If no email is selected, ask/);
});

async function mount(pathname = "/email") {
  const launches: { mode: string; prompt?: string }[] = [];
  const exports = {} as typeof import("../components/ai-launcher.tsx");
  const code = ts.transpileModule(readFileSync(new URL("../components/ai-launcher.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, document, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, require: (name: string) => {
    if (name === "@/components/ai-icon") return { AiIcon: () => null };
    if (name === "@/components/agent-icon") return { AgentIcon: () => null };
    if (name === "@/components/home-prompt-icon") return { HomePromptIcon: ({ name }: { name: string }) => React.createElement("span", { "data-prompt-artwork": name }) };
    if (name === "@/components/language-provider") return { useLanguage: () => ({ t: (value: string) => value }) };
    if (name === "@/lib/page-ai-prompts") return { getPageAiPrompts };
    if (name.endsWith(".css")) return {};
    return require(name);
  } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  async function render(route = pathname) {
    await React.act(async () => root.render(React.createElement(exports.AiLauncher, { key: route, pathname: route, onSelect: (mode, prompt) => launches.push({ mode, prompt }) })));
  }
  function control(mode: "chat" | "agent") { return host.querySelector<HTMLButtonElement>(`[aria-label="Open Filazoo ${mode === "chat" ? "Chat" : "Agent"}"]`)!; }
  function capsules() { return [...host.querySelectorAll<HTMLButtonElement>(".workspace-ai-launcher-prompt")]; }
  async function pointer(target: Element, type: string, pointerType = "mouse", relatedTarget: EventTarget | null = null) {
    const event = new dom.window.MouseEvent(type, { bubbles: true, relatedTarget });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    await React.act(async () => { target.dispatchEvent(event); });
  }
  await render();
  return { host, launches, render, control, capsules, pointer, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("each hovered icon exposes only its own capsules, using home artwork and the correct handoff mode", async () => {
  const ui = await mount();
  try {
    assert.equal(ui.capsules().length, 0);
    assert.equal(ui.control("agent").disabled, true);
    await ui.pointer(ui.control("chat"), "pointerover");
    const suggestions = getPageAiPrompts("/email").prompts;
    assert.equal(ui.capsules().length, 2);
    assert.equal(ui.host.querySelector(".workspace-ai-launcher-prompts")?.textContent, suggestions.slice(0, 2).map(item => item.label).join(""), "only prompt labels appear, without page or mode captions");
    assert.equal(ui.capsules()[0].querySelector("[data-prompt-artwork]")?.getAttribute("data-prompt-artwork"), suggestions[0].icon);
    await ui.pointer(ui.control("chat"), "pointerout", "mouse", ui.control("agent"));
    await ui.pointer(ui.control("agent"), "pointerover", "mouse", ui.control("chat"));
    assert.equal(ui.capsules().length, 2);
    assert.equal(ui.capsules()[0].textContent, "Draft a customer reply");
    assert.ok(!ui.host.textContent?.includes("Summarize my inbox"));
    await React.act(async () => ui.capsules()[0].click());
    assert.deepEqual(ui.launches, [{ mode: "agent", prompt: suggestions[2].prompt }]);
    await ui.pointer(ui.control("agent"), "pointerout", "mouse", ui.control("chat"));
    await ui.pointer(ui.control("chat"), "pointerover", "mouse", ui.control("agent"));
    await React.act(async () => ui.capsules()[1].click());
    assert.deepEqual(ui.launches[1], { mode: "chat", prompt: suggestions[1].prompt });
    await ui.pointer(ui.host.querySelector(".workspace-ai-launcher")!, "pointerout", "mouse", document.body);
    assert.equal(ui.capsules().length, 0);
  } finally { await ui.close(); }
});

test("keyboard focus, Arrow Up, Escape, and route changes keep the launcher usable", async () => {
  const ui = await mount();
  try {
    await React.act(async () => ui.control("chat").focus());
    assert.equal(ui.capsules().length, 2);
    await React.act(async () => { ui.control("chat").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    assert.equal(document.activeElement, ui.capsules()[0]);
    await React.act(async () => { ui.capsules()[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(document.activeElement, ui.control("chat"));
    assert.equal(ui.capsules().length, 0);
    await ui.render("/products");
    assert.equal(ui.capsules().length, 0);
    await React.act(async () => ui.control("chat").focus());
    assert.match(ui.capsules()[0].textContent!, /product availability/);
    assert.ok(!ui.host.textContent?.includes("Summarize my inbox"));
    await React.act(async () => document.getElementById("outside")!.focus());
    assert.equal(ui.capsules().length, 0);
  } finally { await ui.close(); }
});

test("touch reveals each mode's capsules first and outside presses dismiss them", async () => {
  const ui = await mount();
  try {
    async function tap(mode: "chat" | "agent") {
      await ui.pointer(ui.control(mode), "pointerdown", "touch");
      await React.act(async () => {
        ui.control(mode).focus();
        ui.control(mode).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 1 }));
      });
    }
    await tap("chat");
    assert.equal(ui.launches.length, 0);
    assert.equal(ui.capsules().length, 2);
    await tap("agent");
    assert.equal(ui.launches.length, 0);
    assert.match(ui.capsules()[0].textContent!, /Draft a customer reply/);
    await tap("agent");
    assert.deepEqual(ui.launches, [{ mode: "agent", prompt: undefined }]);
    await ui.pointer(document.body, "pointerdown", "touch");
    assert.equal(ui.capsules().length, 0);
  } finally { await ui.close(); }
});
