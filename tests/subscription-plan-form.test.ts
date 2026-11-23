import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as catalog from "../lib/billing/plans.ts";
import * as features from "../lib/billing/features.ts";
import * as paymentIcons from "../lib/payment-icons.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/subscribe?new=1" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "FormData"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const sharedComponents = new Map<string, unknown>();
function requireComponent(name: string): unknown {
  if (!name.startsWith("@/components/ui/")) return require(name);
  if (sharedComponents.has(name)) return sharedComponents.get(name);
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../" + name.slice(2) + ".tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: requireComponent });
  sharedComponents.set(name, exports);
  return exports;
}
const source = ts.transpileModule(readFileSync(new URL("../app/subscribe/plan-form.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

async function mount(props: { enabled: boolean; activePlan?: string; activeSeats?: number; workspaceId?: string } = { enabled: true }) {
  const submissions: Record<string, FormDataEntryValue>[] = [];
  const exports: { PlanForm?: React.ComponentType<typeof props> } = {};
  const dependencies: Record<string, unknown> = { "@/lib/billing/plans": catalog, "@/lib/billing/features": features, "@/lib/payment-icons": paymentIcons, "./actions": { startCheckout: async (_state: unknown, form: FormData) => { submissions.push(Object.fromEntries(form)); return { error: "Checkout test response" }; } } };
  vm.runInNewContext(source, { exports, require: (name: string) => dependencies[name] ?? requireComponent(name) });
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

test("packages include fixed users, shared credits and one checkout price without a seat selector", async () => {
  const ui = await mount();
  try {
    assert.equal(ui.host.querySelector('[name="seats"]'), null);
    assert.equal(ui.host.querySelector('[aria-label="Add a seat"]'), null);
    assert.match(ui.host.querySelector('.subscription-checkout-total')!.textContent!, /139/);
    await ui.click('[name="plan"][value="pro"]');
    assert.match(ui.host.querySelector('.subscription-checkout-selection')!.textContent!, /Pro.*2 users.*6,000 AI credits/);
    assert.match(ui.host.querySelector('.subscription-checkout-total')!.textContent!, /429/);
    await ui.click('[name="plan"][value="business"]');
    assert.match(ui.host.querySelector('.subscription-checkout-selection')!.textContent!, /Business.*5 users.*15,000 AI credits/);
    assert.match(ui.host.querySelector('.subscription-checkout-total')!.textContent!, /929/);
    const form = ui.host.querySelector('form')!;
    ui.host.querySelector<HTMLInputElement>('[name="name"]')!.value = 'Studio Workspace';
    await React.act(async () => form.requestSubmit());
    assert.equal(ui.submissions.length, 1); assert.equal(ui.submissions[0].plan, 'business');
    assert.equal(ui.submissions[0].seats, undefined); assert.equal(ui.submissions[0].amount, undefined);
    assert.match(ui.host.querySelector('[role="alert"]')!.textContent!, /Checkout test response/);
  } finally { await ui.dispose(); }
});

test("package renewal locks the current plan and preserves the workspace identifier", async () => {
  const ui = await mount({ enabled: true, activePlan: 'pro', workspaceId: 'existing-workspace' });
  try {
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="plan"][value="business"]')!.disabled, true);
    assert.match(ui.host.querySelector('.subscription-checkout-selection')!.textContent!, /2 users.*6,000/);
    const data = new dom.window.FormData(ui.host.querySelector('form')!);
    assert.equal(data.get('workspaceId'), 'existing-workspace'); assert.equal(data.get('plan'), 'pro'); assert.equal(data.get('seats'), null);
  } finally { await ui.dispose(); }
});

test("comparison shows shared package limits and shares selection and billing with the cards and checkout", async () => {
  const ui = await mount();
  try {
    const table = ui.host.querySelector('.subscription-comparison-table')!;
    const metrics = [
      ['AI credits / month', 'credits'], ['Customer companies', 'companies'], ['Products', 'products'],
      ['Connected mailboxes', 'mailboxes'], ['Saved workflows', 'flows'], ['Workflow starts / month', 'flowRuns'],
    ] as const;
    for (const [label, key] of metrics) {
      const row = [...table.querySelectorAll('tbody tr')].find(row => row.querySelector('[scope="row"]')?.textContent === label)!;
      assert.deepEqual([...row.querySelectorAll('td')].map(cell => cell.textContent), catalog.plans.map(plan => plan[key].toLocaleString('en-US')));
    }
    for (const plan of catalog.plans) {
      assert.match(table.querySelector(`thead [data-plan="${plan.id}"]`)!.textContent!, new RegExp(String(catalog.planPrice(plan, 'monthly').monthlyCents / 100).replace('.', '\\.')));
      assert.match(table.querySelector(`[data-feature="variants"] td[data-plan="${plan.id}"]`)!.textContent!, /Included/);
      assert.match(table.querySelector(`[data-feature="social"] td[data-plan="${plan.id}"]`)!.textContent!, /Limited access/);
    }
    await ui.click('[aria-label="Select Business from comparison"]');
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="plan"]:checked')?.value, 'business');
    assert.match(ui.host.querySelector('.subscription-checkout-selection')!.textContent!, /Business/);
    assert.equal(ui.submissions.length, 0, 'Comparing a plan must not submit checkout');
    await ui.click('#comparison-annual');
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="billingPeriod"]:checked')?.value, 'annual');
    assert.match(table.querySelector('thead [data-plan="business"]')!.textContent!, /9,348.*year/);
    assert.match(ui.host.querySelector('.subscription-checkout-total')!.textContent!, /9,348/);
    await ui.click('[name="billingPeriod"][value="monthly"]');
    assert.equal(ui.host.querySelector<HTMLInputElement>('#comparison-annual')!.checked, false);
    assert.match(table.querySelector('thead [data-plan="business"]')!.textContent!, /929.*month/);
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

test("feature details expand without changing checkout and disclose beta, credit and connection requirements", async () => {
  const ui = await mount();
  try {
    const panel = (id: string) => ui.host.querySelector<HTMLTableSectionElement>(`#feature-details-${id}`)!;
    assert.equal(panel("products").hidden, false);
    assert.equal(panel("automation").hidden, true);
    await ui.click("#feature-heading-automation");
    assert.equal(panel("automation").hidden, false);
    assert.equal(ui.host.querySelector("#feature-heading-automation")!.getAttribute("aria-expanded"), "true");
    assert.match(ui.host.querySelector('[data-feature="discovery"]')!.textContent!, /Beta.*Uses AI credits/);
    assert.match(ui.host.querySelector('[data-feature="erp"]')!.textContent!, /Account required/);
    assert.match(ui.host.querySelector('[data-feature="lead-integrations"]')!.textContent!, /Existing enabled workspaces only.*Limited access/);
    await ui.click(".subscription-feature-expand-all");
    assert.equal(ui.host.querySelectorAll('tbody[id^="feature-details-"][hidden]').length, 0);
    assert.match(ui.host.querySelector(".subscription-feature-expand-all")!.textContent!, /Collapse feature details/);
    await ui.click(".subscription-feature-expand-all");
    assert.equal(ui.host.querySelectorAll('tbody[id^="feature-details-"][hidden]').length, 6);
    assert.equal(ui.submissions.length, 0);
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="plan"]:checked')!.value, "starter");
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="billingPeriod"]:checked')!.value, "monthly");
    assert.match(ui.host.querySelector(".subscription-checkout-total")!.textContent!, /139/);
  } finally { await ui.dispose(); }
});
