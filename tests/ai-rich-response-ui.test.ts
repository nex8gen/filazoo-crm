import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as presentation from "../lib/ai/response-presentation.ts";
import { buildRecordPresentation } from "../lib/ai/record-presentation.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const id = "15693adc-0bdf-4617-b214-000000000001";
const report = buildRecordPresentation([{ resource: "invoices", records: [{ id, number: 1, status: "draft", total_minor: 10000, paid_minor: 0, document: { customerName: "Draft Buyer", currency: "USD", dueDate: "2026-11-01" } }, { id: "15693adc-0bdf-4617-b214-000000000002", number: 2, status: "issued", total_minor: 25000, paid_minor: 5000, document: { customerName: "Overdue Buyer", currency: "USD", dueDate: "2026-11-01" } }], coverage: { matching: 2, nextOffset: null } }], "invoices", new Date("2026-11-13T02:00:00Z"))!;

async function mount(value?: unknown, legacyText = "", failure = false) {
  const exports = {} as typeof import("../components/ui/ai-response-presentation.tsx");
  const requests: unknown[] = [], downloads: Blob[] = [];
  const code = ts.transpileModule(readFileSync(new URL("../components/ui/ai-response-presentation.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, Intl, Date, Error, Blob, AbortSignal, window: { ...dom.window, setTimeout: (callback: () => void) => { callback(); } }, document: dom.window.document,
    URL: { createObjectURL: (blob: Blob) => { downloads.push(blob); return "blob:test-export"; }, revokeObjectURL() {} },
    fetch: async (_url: string, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return Response.json(failure ? { error: "Current role cannot read these records." } : { presentation: report }, { status: failure ? 403 : 200 }); },
    require: (name: string) => name.endsWith(".css") ? {} : name === "@/lib/ai/response-presentation" ? presentation : require(name),
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(exports.AiResponsePresentation, { presentation: value, legacyText })));
  const click = async (label: string) => { const button = [...host.querySelectorAll("button")].find(node => node.textContent === label); assert.ok(button, label); await React.act(async () => button.click()); };
  return { host, click, requests, downloads, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("response controls switch cards/table/chart, filter statuses, and export exactly the visible rows", async () => {
  const fixture = await mount(report);
  const anchorClick = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  try {
    assert.equal(fixture.host.querySelectorAll("article").length, 2);
    assert.equal(fixture.host.querySelector(`a[href='/invoices/${id}']`)?.textContent, "#1");
    await fixture.click("Table");
    assert.equal(fixture.host.querySelectorAll("tbody tr").length, 2);
    const select = fixture.host.querySelector("select")!;
    await React.act(async () => { select.value = "Overdue"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(fixture.host.querySelectorAll("tbody tr").length, 1);
    assert.ok(fixture.host.querySelector("tbody")?.textContent?.includes("Overdue Buyer"));
    await fixture.click("Export CSV");
    assert.equal(fixture.downloads.length, 1);
    const csv = await fixture.downloads[0].text();
    assert.match(csv, /Overdue Buyer/); assert.doesNotMatch(csv, /Draft Buyer/);
    await fixture.click("Chart");
    assert.equal(fixture.host.querySelectorAll("figure li").length, 2, "charts explicitly use the entire reviewed snapshot");
    assert.match(fixture.host.textContent ?? "", /Chart covers all 2 reviewed records/);
  } finally { dom.window.HTMLAnchorElement.prototype.click = anchorClick; await fixture.close(); }
});

test("older answers load verified linked cards on request and preserve access errors", async () => {
  const fixture = await mount(undefined, `Review [invoice](/invoices/${id})`);
  try {
    assert.equal(fixture.requests.length, 0, "opening history does not perform background record reads");
    await fixture.click("Show record cards");
    assert.deepEqual(fixture.requests, [{ records: [{ resource: "invoices", id }] }]);
    assert.equal(fixture.host.querySelectorAll("article").length, 2);
  } finally { await fixture.close(); }
  const denied = await mount(undefined, `/invoices/${id}`, true);
  try { await denied.click("Show record cards"); assert.match(denied.host.querySelector("[role=alert]")?.textContent ?? "", /Current role/); assert.equal(denied.host.querySelectorAll("article").length, 0); }
  finally { await denied.close(); }
});
