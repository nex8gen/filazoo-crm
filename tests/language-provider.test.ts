import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { createUiLocalizer } from "../lib/ui-localization.ts";
import { translateUiText } from "../lib/i18n.ts";
import { LANGUAGE_STORAGE_KEY } from "../lib/app-language.ts";

const dom = new JSDOM("<!doctype html><html lang='en'><body></body></html>", { url: "https://crm.test" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const h = React.createElement;

async function mount(saved = "en", delayed = false) {
  document.documentElement.lang = "en";
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, saved);
  let release = () => {};
  const download = delayed ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  const exports = {} as typeof import("../components/language-provider.tsx");
  const code = ts.transpileModule(readFileSync("components/language-provider.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  // CommonJS transpilation defers require for dynamic import as a microtask.
  vm.runInNewContext(code, { exports, document, window, Event, require: (name: string) => {
    if (name === "@/lib/app-language") return { LANGUAGE_STORAGE_KEY };
    if (name === "@/lib/ui-localization") return { createUiLocalizer };
    if (name === "@/lib/i18n") return download.then(() => ({ translateUiText }));
    return require(name);
  } });
  let controls: ReturnType<typeof exports.useLanguage>;
  function Screen({ folder }: { folder: string }) {
    controls = exports.useLanguage();
    return h("div", null, h("button", { title: folder }, folder), h("span", { "data-testid": "explicit" }, controls.t("Today's priorities")), h("input", { placeholder: "Search variants", defaultValue: "买家 Products", "data-no-translate": true }));
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = async (folder = "Inbox") => { await React.act(async () => { root.render(h(exports.LanguageProvider, null, h(Screen, { folder }))); }); };
  await render();
  return { host, render, release, switch: async (language: "en" | "zh-CN") => { await React.act(async () => controls!.setLanguage(language)); }, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("React labels and explicitly translated copy survive repeated language changes and rerenders", async () => {
  const ui = await mount();
  try {
    for (let index = 0; index < 3; index++) {
      await ui.switch("zh-CN");
      assert.equal(ui.host.querySelector("button")!.textContent, index ? "已发送" : "收件箱");
      assert.equal(ui.host.querySelector("[data-testid=explicit]")!.textContent, translateUiText("Today's priorities", "zh-CN"));
      await ui.render("Sent");
      assert.equal(ui.host.querySelector("button")!.textContent, "已发送");
      await ui.switch("en");
      assert.equal(ui.host.querySelector("button")!.textContent, "Sent");
      assert.equal(ui.host.querySelector("button")!.title, "Sent");
      assert.equal(ui.host.querySelector("[data-testid=explicit]")!.textContent, "Today's priorities");
      assert.equal(ui.host.querySelector("input")!.value, "买家 Products");
    }
  } finally { await ui.close(); }
});

test("a delayed Chinese download cannot override a more recent English selection", async () => {
  const ui = await mount("en", true);
  try {
    await ui.switch("zh-CN");
    assert.equal(window.localStorage.getItem(LANGUAGE_STORAGE_KEY), "en");
    await ui.switch("en");
    await React.act(async () => ui.release());
    assert.equal(window.localStorage.getItem(LANGUAGE_STORAGE_KEY), "en");
    assert.equal(document.documentElement.lang, "en");
    assert.equal(ui.host.querySelector("button")!.textContent, "Inbox");
  } finally { await ui.close(); }
});

test("a saved Chinese preference is restored on a fresh mount", async () => {
  const ui = await mount("zh-CN");
  try {
    assert.equal(ui.host.querySelector("button")!.textContent, "收件箱");
    assert.equal(document.documentElement.lang, "zh-CN");
    assert.equal(document.documentElement.dataset.language, "zh-CN");
  } finally { await ui.close(); }
});
