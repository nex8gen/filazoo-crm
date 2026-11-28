import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as credits from "../lib/billing/credits.ts";
import * as activity from "../lib/profile-credit-activity.ts";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../app/settings/profile-credit-activity.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

test("activity modes show real totals and the heatmap supports arrow-key navigation with one tab stop", async () => {
  const deps: Record<string, unknown> = { react: React, "@/lib/billing/credits": credits, "@/lib/profile-credit-activity": activity };
  const exports: { ProfileCreditActivity?: React.ComponentType<{ days: activity.CreditActivityDay[]; startDate: string; endDate: string }> } = {};
  vm.runInNewContext(source, { exports, Date, Intl, require: (name: string) => deps[name] ?? require(name) });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(React.createElement(exports.ProfileCreditActivity!, { days: [{ date: "2026-11-06", usedMicros: 1000 }, { date: "2026-11-07", usedMicros: 500 }], startDate: "2026-11-06", endDate: "2026-11-09" })));
    const grid = () => host.querySelector(".profile-activity-grid")!;
    assert.equal(grid().querySelectorAll("button").length, 4);
    assert.equal(grid().querySelectorAll('[tabindex="0"]').length, 1);
    assert.match(host.textContent!, /1 credits used in the past 12 months/);
    assert.doesNotMatch(host.textContent!, /\d\.\d/);
    for (const cell of grid().querySelectorAll("button")) {
      assert.doesNotMatch(cell.getAttribute("aria-label")!, /\d\.\d/);
      assert.doesNotMatch(cell.getAttribute("title")!, /\d\.\d/);
    }
    assert.match(grid().children[1].getAttribute("aria-label")!, /<1 credits used/);
    const last = grid().lastElementChild as HTMLButtonElement;
    await React.act(async () => last.focus());
    await React.act(async () => last.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    assert.equal(document.activeElement, grid().children[2]);
    assert.equal(grid().querySelectorAll('[tabindex="0"]').length, 1);

    const modes = host.querySelectorAll<HTMLButtonElement>(".profile-activity-modes button");
    await React.act(async () => modes[1].click());
    assert.equal(modes[1].getAttribute("aria-pressed"), "true");
    assert.equal(grid().querySelectorAll("button").length, 2);
    assert.match(grid().firstElementChild!.getAttribute("aria-label")!, /1 credits used/);

    await React.act(async () => modes[2].click());
    assert.equal(grid().querySelectorAll("button").length, 4);
    assert.match(grid().lastElementChild!.getAttribute("aria-label")!, /1 cumulative credits/);
    await React.act(async () => modes[0].click());
    assert.equal(grid().lastElementChild!.getAttribute("data-level"), "0");
  } finally {
    await React.act(async () => root.unmount()); host.remove();
  }
});
