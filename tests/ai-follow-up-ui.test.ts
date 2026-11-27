import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { splitFollowUpQuestions } from "../lib/ai/follow-up-questions.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
dom.window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
dom.window.cancelAnimationFrame = id => { frames.delete(id); };
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const exports = {} as typeof import("../components/ui/ai-agent-response.tsx");
const code = ts.transpileModule(readFileSync(new URL("../components/ui/ai-agent-response.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
vm.runInNewContext(code, { exports, window: dom.window, require: (name: string) => {
  if (name.endsWith(".css")) return {};
  if (name === "@/components/language-provider") return { useLanguage: () => ({ language: "en", t: (text: string) => text }) };
  if (name === "@/lib/ai/follow-up-questions") return { splitFollowUpQuestions };
  if (name === "@/components/ui/ai-markdown") return { AiMarkdown: ({ text }: { text: string }) => React.createElement("p", { "data-answer": true }, text) };
  if (name.startsWith("@/")) return {};
  return require(name);
} });

const text = "Buyer requested a final quotation.\n\nRelated questions: What is blocking this order? · What should we ask next?";

test("completed answers render action buttons that submit the exact question on click", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), submitted: string[] = [];
  const props = { text, animate: false, onFollowUp: (question: string) => submitted.push(question) };
  try {
    await React.act(async () => root.render(React.createElement(exports.StreamingText, props)));
    assert.equal(host.querySelector("[data-answer]")?.textContent, "Buyer requested a final quotation.");
    const buttons = host.querySelectorAll<HTMLButtonElement>("button.agent-follow-up-button");
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].type, "button");
    assert.equal(buttons[0].textContent, "What is blocking this order?");
    assert.equal(host.querySelector('[role="group"]')?.getAttribute("aria-label"), "Related questions");
    assert.equal(submitted.length, 0, "Rendering suggestions does not submit a request");
    await React.act(async () => buttons[0].click());
    assert.deepEqual(submitted, ["What is blocking this order?"]);
    await React.act(async () => root.render(React.createElement(exports.StreamingText, { ...props, followUpsDisabled: true })));
    await React.act(async () => buttons[1].click());
    assert.equal(submitted.length, 1, "Busy state disables all suggestion buttons");
    assert.ok(buttons[1].disabled);
  } finally { await React.act(async () => root.unmount()); host.remove(); }
});

test("suggestion buttons wait for the answer reveal to finish", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(React.createElement(exports.StreamingText, { text, animate: true, onFollowUp() {} })));
    assert.equal(host.querySelectorAll("button").length, 0);
    for (const time of [0, 4000]) await React.act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); });
    assert.equal(host.querySelectorAll("button").length, 2);
    assert.equal(host.querySelector("[aria-busy]")?.getAttribute("aria-busy"), "false");
  } finally { await React.act(async () => root.unmount()); host.remove(); }
});
