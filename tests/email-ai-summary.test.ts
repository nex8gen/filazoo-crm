import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import type { EmailSummary } from "../lib/ai/email-summary.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const output: EmailSummary = { title: "Conversation analysis", summary: "The sender asks about PLA.", nextStep: "Confirm the requested quantity.", followUpAt: null, followUpReason: "No follow-up required." };
const code = ts.transpileModule(readFileSync(new URL("../components/email-ai-summary.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

async function mount(autoAnalyze: boolean, ready = true, failFirst = false) {
  const requests: string[] = [];
  const exports = {} as typeof import("../components/email-ai-summary.tsx");
  vm.runInNewContext(code, { exports, Error, require: (name: string) => {
    if (name === "@/components/language-provider") return { useLanguage: () => ({ language: "en" }) };
    if (name === "@/components/ai-icon") return { AiIcon: () => null };
    if (name === "@/components/ui/notification-toast") return notificationToastModule;
    if (name === "@/lib/email-summary-client") return { requestEmailSummary: async (body: string) => {
      requests.push(body);
      if (failFirst && requests.length === 1) throw new Error("Temporary failure");
      return { summary: output, cached: false };
    } };
    return require(name);
  } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  async function render(nextAuto = autoAnalyze, nextReady = ready, key = "first") {
    await React.act(async () => root.render(React.createElement(exports.EmailAiSummary, {
      key, context: JSON.stringify({ messageId: key }), autoAnalyze: nextAuto, ready: nextReady,
      configured: true, currentFollowUpAt: null, scheduleFollowUp: false,
      onAnalyzed: async () => assert.fail("Reading a summary must not schedule a follow-up"),
    })));
  }
  async function click(label: string) {
    const button = [...host.querySelectorAll("button")].find(item => item.textContent === label);
    assert.ok(button, `Missing ${label} button`);
    await React.act(async () => button.click());
  }
  await render();
  return { host, requests, render, click, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("unlinked emails wait for a click and do not carry approval to another conversation", async () => {
  const ui = await mount(false);
  try {
    assert.equal(ui.requests.length, 0);
    assert.match(ui.host.textContent!, /Analyze with AI/);
    await ui.render(false, true);
    assert.equal(ui.requests.length, 0);
    await ui.click("Analyze with AI");
    assert.equal(ui.requests.length, 1);
    assert.match(ui.host.textContent!, /Conversation analysis/);
    await ui.render(false, true, "second");
    assert.equal(ui.requests.length, 1);
    assert.match(ui.host.textContent!, /Analyze with AI/);
  } finally { await ui.close(); }
});

test("linked company emails analyze automatically once their message is ready", async () => {
  const ui = await mount(true, false);
  try {
    assert.equal(ui.requests.length, 0);
    await ui.render(true, true);
    assert.equal(ui.requests.length, 1);
    assert.match(ui.host.textContent!, /Conversation analysis/);
  } finally { await ui.close(); }
});

test("manual analysis waits for message loading and supports retry after failure", async () => {
  const ui = await mount(false, false, true);
  try {
    assert.equal(ui.host.querySelector("button")?.disabled, true);
    await ui.click("Analyze with AI");
    assert.equal(ui.requests.length, 0);
    await ui.render(false, true);
    assert.equal(ui.requests.length, 0);
    await ui.click("Analyze with AI");
    assert.equal(ui.requests.length, 1);
    assert.match(ui.host.textContent!, /Temporary failure/);
    await ui.click("Try again");
    assert.equal(ui.requests.length, 2);
    assert.match(ui.host.textContent!, /Conversation analysis/);
  } finally { await ui.close(); }
});
