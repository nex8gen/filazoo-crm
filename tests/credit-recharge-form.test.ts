import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as credits from "../lib/billing/credits.ts";
import * as recharge from "../lib/billing/recharge.ts";
import { randomUUID } from "node:crypto";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/settings/credits" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "FormData", "Event"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../app/subscribe/credit-pack-form.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

test("changing the recharge amount updates the final total and submits only the selected quantity and quote", async () => {
  const submissions: Record<string, FormDataEntryValue>[] = [];
  let refreshes = 0;
  const exports: { CreditPackForm?: React.ComponentType<{ workspaceId: string; enabled: boolean; pricing: recharge.RechargePricing }> } = {};
  const dependencies: Record<string, unknown> = {
    "@/components/ui/dialog": { Dialog: () => null },
    "@/lib/billing/credit-events": { AI_CREDITS_CHANGED: "ai-credits-changed" },
    "./discount-actions": { applyCreditDiscount: async () => ({ discountPercent: 100 }) },
    "@/lib/billing/credits": credits, "@/lib/billing/recharge": recharge,
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "./recharge-actions": { startCreditRecharge: async (_state: unknown, form: FormData) => { submissions.push(Object.fromEntries(form)); return { error: "Refresh pricing before recharging" }; } },
  };
  vm.runInNewContext(source, { exports, require: (name: string) => name in dependencies ? dependencies[name] : require(name), crypto: { randomUUID }, window, Event });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const pricing = { id: "cccccccc-1111-4111-8111-111111111111", rateMicros: 6_630_000, expiresAt: "2099-01-01T00:00:00Z" };
  await React.act(async () => root.render(React.createElement(exports.CreditPackForm!, { workspaceId: "workspace", enabled: true, pricing })));
  const setQuantity = async (value: string) => React.act(async () => {
    const input = host.querySelector<HTMLInputElement>('[name="credits"]')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  try {
    assert.match(host.textContent!, /19.89/);
    await setQuantity("12345");
    assert.match(host.textContent!, /81.85/);
    assert.equal(host.querySelector<HTMLInputElement>('[name="credits"]')!.value, "12345");
    assert.equal(host.querySelector<HTMLInputElement>('[name="expectedAmountFen"]')!.value, "8185");
    for (const value of ["", "0", "1.5", "1e3", "99999999999999999999"]) {
      await setQuantity(value);
      assert.equal(host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled, true);
    }
    await setQuantity("1");
    assert.match(host.querySelector('.billing-pack-price')!.textContent!, /0.01/);
    await setQuantity("12345");
    await React.act(async () => host.querySelector('form')!.requestSubmit());
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].credits, "12345");
    assert.equal(submissions[0].pricingId, pricing.id);
    assert.equal(submissions[0].workspaceId, "workspace");
    assert.equal(submissions[0].expectedAmountFen, "8185");
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /Refresh pricing/);
    await React.act(async () => host.querySelector<HTMLButtonElement>('.billing-recharge-error button')!.click());
    assert.equal(refreshes, 1);
  } finally {
    await React.act(async () => root.unmount()); host.remove();
  }
});

test("offline checkout opens a notice and an account discount permits repeat free recharges", async () => {
  const submissions: Record<string, FormDataEntryValue>[] = [];
  let refreshes = 0;
  let events = 0;
  const updated = () => { events++; };
  window.addEventListener("ai-credits-changed", updated);
  const exports: { CreditPackForm?: React.ComponentType<{ workspaceId: string; enabled: boolean }> } = {};
  const wrap = ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children);
  const dependencies: Record<string, unknown> = {
    "@/lib/billing/credits": credits, "@/lib/billing/recharge": recharge,
    "@/lib/billing/credit-events": { AI_CREDITS_CHANGED: "ai-credits-changed" },
    "@/components/ui/dialog": {
      Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? React.createElement("div", { role: "dialog" }, children) : null,
      DialogContent: wrap, DialogHeader: wrap, DialogTitle: wrap, DialogDescription: wrap, DialogFooter: wrap, DialogClose: wrap,
    },
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "./discount-actions": { applyCreditDiscount: async (_workspace: string, code: string) => code === "FIXTURE-FREE" ? { discountPercent: 100 } : { error: "This discount code is not available for your account." } },
    "./recharge-actions": { startCreditRecharge: async (_state: unknown, form: FormData) => { submissions.push(Object.fromEntries(form)); return { success: true, credits: Number(form.get("credits")) }; } },
  };
  vm.runInNewContext(source, { exports, require: (name: string) => name in dependencies ? dependencies[name] : require(name), crypto: { randomUUID }, window, Event });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const edit = async (name: string, value: string) => React.act(async () => {
    const input = host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  try {
    await React.act(async () => root.render(React.createElement(exports.CreditPackForm!, { workspaceId: "workspace", enabled: false })));
    assert.equal(host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled, false);
    await React.act(async () => host.querySelector('form')!.requestSubmit());
    assert.match(host.querySelector('[role="dialog"]')!.textContent!, /Alipay payment is not available at this time/);
    assert.equal(submissions.length, 0);
    await edit("discountCode", "INVALID-CODE");
    await React.act(async () => host.querySelector<HTMLButtonElement>('.billing-discount-input button')!.click());
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /not available for your account/);
    await edit("discountCode", " fixture-free ");
    await React.act(async () => host.querySelector<HTMLButtonElement>('.billing-discount-input button')!.click());
    assert.match(host.querySelector('.billing-pack-price')!.textContent!, /¥0.00/);
    assert.match(host.querySelector('[type="submit"]')!.textContent!, /Recharge for free/);
    await edit("credits", "12345");
    await React.act(async () => host.querySelector('form')!.requestSubmit());
    assert.match(host.textContent!, /12,345 credits added/);
    await React.act(async () => host.querySelector('form')!.requestSubmit());
    assert.equal(submissions.length, 2);
    assert.equal(submissions[0].credits, "12345");
    assert.notEqual(submissions[0].requestId, submissions[1].requestId);
    assert.equal(refreshes, 2);
    assert.equal(events, 2);
    await edit("discountCode", "CHANGED");
    assert.doesNotMatch(host.querySelector('[type="submit"]')!.textContent!, /free/);
    assert.equal(host.querySelector('.billing-pack-price')!.textContent!, "—");
  } finally { window.removeEventListener("ai-credits-changed", updated); await React.act(async () => root.unmount()); host.remove(); }
});

test("confirmed recharges return to the balance while subscription payments retain their setup flow", async () => {
  const paymentSource = ts.transpileModule(readFileSync(new URL("../app/subscribe/orders/[id]/payment-status.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const kind of ["credits", "subscription"] as const) {
    const destinations: string[] = [];
    let checks = 0;
    const router = { replace: (path: string) => destinations.push(path), refresh() {} };
    const exports: { PaymentStatus?: React.ComponentType<{ id: string; initialStatus: string; initialExpired: boolean; workspaceId: string; kind: typeof kind }> } = {};
    const dependencies: Record<string, unknown> = {
      "next/navigation": { useRouter: () => router },
      "next/link": { default: ({ children }: { children: React.ReactNode }) => React.createElement("a", null, children) },
      "@/components/onboarding-completion.module.css": { default: {} },
    };
    vm.runInNewContext(paymentSource, { exports, require: (name: string) => name in dependencies ? dependencies[name] : require(name), document, navigator, AbortController, setTimeout, clearTimeout,
      fetch: async (url: string, options: { method: string }) => { checks++; assert.equal(url, "/api/billing/orders/order/complete"); assert.equal(options.method, "POST"); return Response.json({ success: true }); },
    });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await React.act(async () => root.render(React.createElement(exports.PaymentStatus!, { id: "order", initialStatus: "paid", initialExpired: false, workspaceId: "workspace", kind })));
      assert.equal(checks, 1);
      assert.deepEqual(destinations, [kind === "credits" ? "/settings/credits" : "/workspaces/setup"]);
      assert.match(host.textContent!, kind === "credits" ? /Credits added/ : /Payment confirmed/);
    } finally { await React.act(async () => root.unmount()); host.remove(); }
  }
});
