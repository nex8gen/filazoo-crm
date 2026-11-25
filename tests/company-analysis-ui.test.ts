import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as model from "../lib/company-analysis.ts";

const require = createRequire(import.meta.url);
const styles = new Proxy({}, { get: (_, key) => String(key) });
const modules: Record<string, unknown> = {
  react: React, "react/jsx-runtime": require("react/jsx-runtime"),
  "next/link": { default: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children) },
  "@/lib/company-analysis": model,
  "./analytics-surface.module.css": { default: styles }, "./company-analysis.module.css": { default: styles },
  "@/components/ui/analytics-chart-card": { AnalyticsTrendPlot: ({ label, data, size }: { label: string; data: { value: number }[]; size: string }) =>
    React.createElement("div", { role: "img", "aria-label": label, "data-size": size, "data-values": data.map(row => row.value).join(",") }) },
};
const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
vm.runInNewContext(ts.transpileModule(readFileSync("components/company-analysis-overview.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, require: (name: string) => modules[name] ?? require(name) });

test("customer analysis switches chart criteria and distinguishes missing email data from zero activity", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const data: model.CompanyAnalysisData = {
    orders: [{ id: "po", reference: "PO-1", orderDate: "2026-10-10", deliveryDate: "", currency: "USD", status: "confirmed", items: [{ description: "PLA", sku: "PLA", quantity: 2, unitPriceMinor: 500 }] }],
    products: [], tasks: [], asOf: "2026-10-27T12:00:00Z", email: { available: true, partial: false, messages: [
      { id: "sent", direction: "outbound", timestamp: "2026-10-01T00:00:00Z", messageId: "<sent>" },
      { id: "received", direction: "inbound", timestamp: "2026-10-02T00:00:00Z", inReplyTo: "<sent>" },
    ] },
  };
  const range = { from: "2026-09-01", to: "2026-10-27" };
  const render = async (source: model.CompanyAnalysisData) => {
    await React.act(async () => root.render(React.createElement(exports.CompanyAnalysisOverview, {
      companyId: "customer", data: source, analysis: model.companyPurchaseAnalysis(source, "USD", range), range,
      locale: "en-US", copy: (en: string) => en, money: (minor: number) => `$${(minor / 100).toFixed(2)}`, number: String,
    })));
  };
  try {
    await render(data);
    assert.equal(container.querySelectorAll("article").length, 8);
    assert.ok(container.textContent!.includes("Total emails"));
    assert.ok(container.textContent!.includes("Conversations"));
    assert.ok(!container.textContent!.includes("Drafts and cancellations"));
    const purchases = container.querySelector('[role="group"][aria-label="Purchases"]')!;
    const orders = [...purchases.querySelectorAll("button")].find(button => button.textContent === "Orders")!;
    await React.act(async () => orders.click());
    assert.equal(orders.getAttribute("aria-pressed"), "true");
    assert.equal(container.querySelector('[role="img"][aria-label="Purchases"]')?.getAttribute("data-values"), "0,1");
    const received = [...container.querySelector('[role="group"][aria-label="Email activity"]')!.querySelectorAll("button")].find(button => button.textContent === "Received")!;
    await React.act(async () => received.click());
    assert.equal(container.querySelector('[role="img"][aria-label="Email activity"]')?.getAttribute("data-values"), "0,1");
    await render({ ...data, email: { messages: [], available: true, partial: false } });
    assert.equal(container.querySelector('[role="img"][aria-label="Email activity"]')?.getAttribute("data-values"), "0,0");
    assert.ok(!container.textContent!.includes("Email history unavailable"));
    await render({ ...data, email: { messages: [], available: false, partial: false } });
    assert.ok(container.textContent!.includes("Email history unavailable"));
    assert.equal(container.querySelector('[role="img"][aria-label="Email activity"]'), null);
    assert.ok(container.querySelector('[role="img"][aria-label="Purchases"]'));
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
