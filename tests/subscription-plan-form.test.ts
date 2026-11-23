import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as catalog from "../lib/billing/plans.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/subscribe?new=1" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "FormData"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../app/subscribe/plan-form.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

async function mount(props: { enabled: boolean; activePlan?: string; activeSeats?: number; workspaceId?: string } = { enabled: true }) {
  const submissions: Record<string, FormDataEntryValue>[] = [];
  const exports: { PlanForm?: React.ComponentType<typeof props> } = {};
  const dependencies: Record<string, unknown> = { "@/lib/billing/plans": catalog, "./actions": { startCheckout: async (_state: unknown, form: FormData) => { submissions.push(Object.fromEntries(form)); return { error: "Checkout test response" }; } } };
  vm.runInNewContext(source, { exports, require: (name: string) => dependencies[name] ?? require(name) });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await React.act(async () => { root.render(React.createElement(exports.PlanForm!, props)); });
  const click = async (selector: string) => { await React.act(async () => { host.querySelector<HTMLElement>(selector)!.click(); }); };
  const inputSeats = async (value: string) => { await React.act(async () => {
    const input = host.querySelector<HTMLInputElement>('[name="seats"]')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  }); };
  return { host, click, inputSeats, submissions, dispose: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("plan selection and team size update the actual checkout payload, CNY total, and pooled credits", async () => {
  const ui = await mount();
  try {
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="plan"]:checked')?.value, "starter");
    assert.match(ui.host.querySelector(".subscription-checkout-total")!.textContent!, /¥139/);
    await ui.click('[name="plan"][value="business"]');
    await ui.click('[aria-label="Add a seat"]');
    assert.match(ui.host.querySelector(".subscription-checkout-selection")!.textContent!, /Business.*2 seats.*24,000 AI credits/);
    assert.match(ui.host.querySelector(".subscription-checkout-total")!.textContent!, /¥1,118/);
    const form = ui.host.querySelector("form")!;
    const name = ui.host.querySelector<HTMLInputElement>('[name="name"]')!; name.value = "Studio Workspace";
    await React.act(async () => { form.requestSubmit(); });
    assert.equal(ui.submissions.length, 1);
    assert.equal(ui.submissions[0].plan, "business"); assert.equal(ui.submissions[0].seats, "2"); assert.equal(ui.submissions[0].name, "Studio Workspace");
    assert.equal(ui.submissions[0].amount, undefined);
    assert.match(ui.host.querySelector('[role="alert"]')!.textContent!, /Checkout test response/);
  } finally { await ui.dispose(); }
});

test("invalid seat quantities cannot proceed and the stepper stays within one to one hundred", async () => {
  const ui = await mount();
  try {
    assert.equal(ui.host.querySelector<HTMLButtonElement>('[aria-label="Remove a seat"]')!.disabled, true);
    for (const value of ["", "0", "1.5", "101"]) {
      await ui.inputSeats(value);
      assert.equal(ui.host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled, true, value);
    }
    await ui.inputSeats("100");
    assert.equal(ui.host.querySelector<HTMLButtonElement>('[aria-label="Add a seat"]')!.disabled, true);
    await ui.click('[aria-label="Remove a seat"]');
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="seats"]')!.value, "99");
    assert.equal(ui.host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled, false);
  } finally { await ui.dispose(); }
});

test("renewal preserves the paid plan and seats and sends the existing workspace ID", async () => {
  const ui = await mount({ enabled: true, activePlan: "pro", activeSeats: 3, workspaceId: "existing-workspace" });
  try {
    assert.equal(ui.host.querySelector('[name="name"]'), null);
    const seats = ui.host.querySelector<HTMLInputElement>('[name="seats"]')!;
    assert.equal(seats.readOnly, true); assert.equal(seats.value, "3");
    for (const button of ui.host.querySelectorAll<HTMLButtonElement>('.subscription-seat-control button')) assert.equal(button.disabled, true);
    await ui.click('[name="plan"][value="business"]');
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="plan"]:checked')?.value, "pro");
    assert.match(ui.host.querySelector(".subscription-checkout-total")!.textContent!, /¥837/);
    assert.match(ui.host.querySelector('[type="submit"]')!.textContent!, /Renew with Alipay/);
    const data = new dom.window.FormData(ui.host.querySelector("form")!);
    assert.equal(data.get("workspaceId"), "existing-workspace"); assert.equal(data.get("plan"), "pro"); assert.equal(data.get("seats"), "3");
  } finally { await ui.dispose(); }
});

test("unavailable payment stays disabled and every plan includes the catalog's actual limits", async () => {
  const ui = await mount({ enabled: false });
  try {
    assert.equal(ui.host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled, true);
    assert.match(ui.host.querySelector('[role="status"]')!.textContent!, /payments are being activated/);
    for (const plan of catalog.plans) {
      const card = ui.host.querySelector(`.subscription-plan-card[data-plan="${plan.id}"]`)!;
      assert.match(card.textContent!, new RegExp(plan.credits.toLocaleString("en-US")));
      assert.match(card.textContent!, new RegExp(plan.companies.toLocaleString("en-US")));
      assert.match(card.textContent!, new RegExp(`${plan.documentBytes / 1e9} GB`));
      assert.equal(card.querySelectorAll("li").length, 6);
    }
  } finally { await ui.dispose(); }
});
