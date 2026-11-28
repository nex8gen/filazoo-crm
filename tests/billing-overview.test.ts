import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as credits from "../lib/billing/credits.ts";
import * as plans from "../lib/billing/plans.ts";
import * as recharge from "../lib/billing/recharge.ts";
import type { ReactNode } from "react";

const require = createRequire(import.meta.url);
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function component(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => name in dependencies ? dependencies[name] : require(name), Date, Object });
  return exports;
}
const { CreditSummary } = component("../app/settings/credits/credit-summary.tsx", { "@/lib/billing/credits": credits });
const pricing = { id: "cccccccc-1111-4111-8111-111111111111", rateMicros: 6_630_000, expiresAt: "2099-01-01T00:00:00Z" };
function page(dependencies: Record<string, unknown>) {
  dependencies = { "./credit-summary": { CreditSummary }, "./refresh-usage": { RefreshUsage: () => createElement("button", null, "Refresh usage") }, "./credits.css": {}, "@/lib/billing/recharge-pricing": { getRechargePricing: async () => pricing }, ...dependencies };
  const exports: Record<string, () => Promise<ReactNode>> = {};
  const source = ts.transpileModule(readFileSync(new URL("../app/settings/credits/page.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => name in dependencies ? dependencies[name] : require(name), Date, Object });
  return exports.default;
}

test("members can see shared credits without loading the administrator ledger or purchasing controls", async () => {
  for (const role of ["viewer", "operator", "bd_manager"]) {
    let scoped = false;
    const viewer = { id: "member", workspaceId: "workspace", role };
    const render = page({
      "next/link": { default: () => null }, "@/lib/auth": { requireWorkspaceMember: async () => viewer },
      "@/lib/billing/overview": { billingOverview: () => assert.fail("Member must not access the administrator ledger") },
      "@/lib/billing/credits": credits, "@/lib/billing/plans": plans,
      "@/lib/billing/alipay": {}, "@/app/subscribe/credit-pack-form": { CreditPackForm: () => assert.fail("No member checkout") },
      "@/components/ai-usage-panel": { AiUsagePanel: ({ limits }: { limits: { credits: { remainingMicros: number } } }) => createElement("p", null, credits.formatCredits(limits.credits.remainingMicros)) },
      "@/lib/workspace-context": { withWorkspaceViewer: async (actor: unknown, run: () => unknown) => { assert.equal(actor, viewer); scoped = true; return run(); } },
      "@/lib/ai/budget-server": { readAiBudget: async (id: string) => { assert.equal(id, viewer.id); assert.equal(scoped, true); return { credits: { remainingMicros: 1234000, includedMicros: 2000000, usedMicros: 766000, topupMicros: 0, resetsAt: "2026-12-01T00:00:00Z" } }; } },
    });
    const html = renderToStaticMarkup(await render());
    assert.match(html, /1,234/); assert.match(html, /Ask your workspace owner/);
    assert.doesNotMatch(html, /Recent AI requests|Buy credits|administrator ledger/);
  }
});

test("only the workspace owner sees the credit checkout on the administrator usage page", async () => {
  for (const owner of [true, false]) for (const complimentary of [true, false]) {
    const render = page({
      "next/link": { default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) },
      "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "admin", role: "admin", ownerId: owner ? "admin" : "another-owner", workspaceId: "workspace" }) },
      "@/lib/billing/overview": { billingOverview: async () => ({ plan: "pro", seats: 2, active: true, grandfathered: false, complimentary,
        credits: { includedMicros: 10000000, topupMicros: 0, remainingMicros: 8000000, usedMicros: 2000000, percent: 20, resetsAt: "2026-12-23T00:00:00Z" },
        limits: { companies: 20000 }, usage: { companies: 120, products: 5, mailboxes: 2, flows: 3, workflowEmails: 20, documentBytes: 1000 }, history: [{model:"internal-provider/model-name",reserved_micros:1000,charged_micros:1000,created_at:"2026-11-23T00:00:00Z",id:"internal-request"}] }) },
      "@/lib/billing/credits": credits, "@/lib/billing/plans": plans, "@/lib/billing/alipay": { alipayReady: () => true },
      "@/app/subscribe/credit-pack-form": { CreditPackForm: ({ enabled }: { enabled: boolean }) => createElement("button", { disabled: !enabled }, "Buy credits with Alipay") },
      "@/components/ai-usage-panel": {}, "@/lib/workspace-context": {}, "@/lib/ai/budget-server": {},
    });
    const html = renderToStaticMarkup(await render());
    assert.match(html, /8,000/); assert.match(html, /20,000/); assert.match(html, /Monthly allowance/);
    assert.doesNotMatch(html, /Recent AI requests|internal-provider|internal-request|Settled|Reserved|background AI|awaiting registration/);
    assert.equal(html.includes("Buy credits with Alipay"), owner);
    assert.equal(html.includes("Complimentary plan"), complimentary);
    if (complimentary) assert.doesNotMatch(html,/paid seat\(s\)/);
  }
});

test("credit availability ignores rounded legacy percentages and handles empty and low balances", () => {
  const renderSummary = CreditSummary as (props: { credits: credits.CreditBalance }) => ReactNode;
  const balance = { includedMicros: 72000000, topupMicros: 0, remainingMicros: 71999000, usedMicros: 1000, percent: 1, resetsAt: "2026-12-01T00:00:00Z" };
  let html = renderToStaticMarkup(renderSummary({ credits: balance }));
  assert.match(html, /71,999/);
  assert.doesNotMatch(html, /running low/);
  assert.equal(credits.formatUsagePercent(credits.usagePercent(1000, 72000000)!), "<0.1%");
  assert.equal(credits.usagePercent(-5, 10), 0);
  assert.equal(credits.usagePercent(15, 10), 100);
  assert.equal(credits.usagePercent(0, null), null);
  html = renderToStaticMarkup(renderSummary({ credits: { ...balance, remainingMicros: 0, usedMicros: 72000000 } }));
  assert.match(html, /aria-valuenow="0"/);
  assert.match(html, /Your AI credits are used up/);
  html = renderToStaticMarkup(renderSummary({ credits: { ...balance, includedMicros: 0, remainingMicros: 0, usedMicros: 0, resetsAt: "invalid" } }));
  assert.doesNotMatch(html, /NaN|Invalid Date/);
  assert.match(html, /aria-valuenow="0"/);
});

test("recharge keeps the payment button available while inactive subscriptions stay blocked", () => {
  const { CreditPackForm } = component("../app/subscribe/credit-pack-form.tsx", {
    "react": { ...require("react"), useActionState: () => [{}, "/checkout-fixture", false], useState: (value: unknown) => [value, () => {}], useRef: () => ({ current: null }), useTransition: () => [false, () => {}], useId: () => "recharge-credits" },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/components/ui/dialog": { Dialog: () => null },
    "@/lib/billing/credit-events": { AI_CREDITS_CHANGED: "ai-credits-changed" },
    "./discount-actions": { applyCreditDiscount: () => assert.fail("Rendering must not apply a code") },
    "./recharge-actions": { startCreditRecharge: () => assert.fail("Rendering must not start a payment") },
    "@/lib/billing/recharge": recharge,
    "@/lib/billing/credits": credits,
  });
  const renderPack = CreditPackForm as (props: { workspaceId: string; enabled: boolean; subscriptionActive?: boolean; pricing?: recharge.RechargePricing }) => ReactNode;
  const unavailable = renderToStaticMarkup(renderPack({ workspaceId: "workspace", enabled: false, pricing }));
  assert.match(unavailable, /Recharge with Alipay/);
  assert.match(unavailable, /Discount code/);
  assert.match(unavailable, /¥19.89/);
  assert.match(unavailable, /<button type="submit" class/);
  const inactive = renderToStaticMarkup(renderPack({ workspaceId: "workspace", enabled: false, subscriptionActive: false, pricing }));
  assert.match(inactive, /Renew your workspace subscription/);
  assert.match(inactive, /<button type="submit" disabled/);
  const enabled = renderToStaticMarkup(renderPack({ workspaceId: "workspace", enabled: true, pricing }));
  assert.match(enabled, /Recharge with Alipay/);
  assert.match(enabled, /name="workspaceId" value="workspace"/);
  assert.match(enabled, /name="credits"[^>]*value="3000"/);
  assert.match(enabled, /name="expectedAmountFen" value="1989"/);
  const noPricing = renderToStaticMarkup(renderPack({ workspaceId: "workspace", enabled: true }));
  assert.match(noPricing, /pricing is temporarily unavailable/);
  assert.match(noPricing, /Refresh pricing/);
});
