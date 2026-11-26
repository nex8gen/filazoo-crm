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
  vm.runInNewContext(code, { exports, Intl, Date, Error, Blob, AbortSignal, URLSearchParams, window: { ...dom.window, setTimeout: (callback: () => void) => { callback(); } }, document: dom.window.document,
    URL: { createObjectURL: (blob: Blob) => { downloads.push(blob); return "blob:test-export"; }, revokeObjectURL() {} },
    fetch: async (url: string, init: RequestInit) => {
      if (url.startsWith("/api/ai/assistant/conversations?")) {
        requests.push(Object.fromEntries(new URL(url, "https://crm.test").searchParams));
        return Response.json({ messages: [{ id: "sent-reply", sender: "enphany@example.com", direction: "outbound", timestamp: "2026-11-26T01:39:00Z", available: true, truncated: false, body: "Hello buyer. <script>untrusted email</script>" }], more: false });
      }
      requests.push(JSON.parse(String(init.body))); return Response.json(failure ? { error: "Current role cannot read these records." } : { presentation: report }, { status: failure ? 403 : 200 });
    },
    require: (name: string) => name.endsWith(".css") ? {} : name === "@/lib/ai/response-presentation" ? presentation : require(name),
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(exports.AiResponsePresentation, { presentation: value, legacyText })));
  const click = async (label: string) => { const button = [...host.querySelectorAll("button")].find(node => node.textContent === label); assert.ok(button, label); await React.act(async () => button.click()); };
  return { host, click, requests, downloads, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("cards, table and chart appear in separate sections and record filters preserve the chart snapshot", async () => {
  const fixture = await mount(report);
  const anchorClick = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  try {
    assert.equal(fixture.host.querySelectorAll("article").length, 2);
    assert.equal(fixture.host.querySelector(`a[href='/invoices/${id}']`)?.textContent, "#1");
    const details = fixture.host.querySelector("details")!;
    assert.equal(details.open, false, "source context stays out of the chat summary");
    assert.ok(details.textContent?.includes(report.sections[0].description), "full coverage remains available on demand");
    assert.equal(fixture.host.querySelector("[aria-pressed], [role=tab], [role=tablist]"), null, "data sections do not require view switching");
    const blocks = fixture.host.querySelectorAll(".ai-result-block");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].querySelectorAll("article").length, 2);
    assert.equal(blocks[1].querySelectorAll("table").length, 1);
    assert.equal(blocks[2].querySelectorAll("figure").length, 1);
    assert.equal(fixture.host.querySelectorAll("tbody tr").length, 2);
    const select = fixture.host.querySelector("select")!;
    await React.act(async () => { select.value = "Overdue"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(fixture.host.querySelectorAll("tbody tr").length, 1);
    assert.equal(fixture.host.querySelectorAll("article").length, 1, "cards and table share the record filters");
    assert.ok(fixture.host.querySelector("tbody")?.textContent?.includes("Overdue Buyer"));
    await fixture.click("Export CSV");
    assert.equal(fixture.downloads.length, 1);
    const csv = await fixture.downloads[0].text();
    assert.match(csv, /Overdue Buyer/); assert.doesNotMatch(csv, /Draft Buyer/);
    assert.equal(fixture.host.querySelectorAll("figure li").length, 2, "charts explicitly use the entire reviewed snapshot");
    assert.match(fixture.host.querySelector("figcaption")?.textContent ?? "", /All 2 reviewed records/);
  } finally { dom.window.HTMLAnchorElement.prototype.click = anchorClick; await fixture.close(); }
});

test("customer replies show only compact dated conversations and load message bodies on expansion", async () => {
  const fixture = await mount({ version: 1, capturedAt: "2026-11-26T03:00:00Z", sections: [], conversations: [{ companyId: id, companyName: "Carraro", state: "ready", more: false,
    threads: [{ id: "saved-thread", sender: "enphany@example.com", subject: "Re: Shopify enquiry", direction: "outbound", timestamp: "2026-11-26T01:39:00Z" }] }] });
  try {
    assert.equal(fixture.requests.length, 0, "Rendering an answer must not fetch message bodies");
    assert.equal(fixture.host.querySelectorAll(".ai-conversation").length, 1);
    assert.equal(fixture.host.querySelectorAll("table, .ai-result-cards, .ai-result-snapshot, .ai-result-export").length, 0);
    assert.match(fixture.host.querySelector("summary")?.textContent ?? "", /enphany@example.com.*Re: Shopify enquiry.*Nov 26, 2026.*09:39/);
    const thread = fixture.host.querySelector("details")!;
    await React.act(async () => { thread.open = true; thread.dispatchEvent(new Event("toggle")); });
    assert.equal(fixture.requests.length, 1);
    assert.match(fixture.host.querySelector("article p")?.textContent ?? "", /Hello buyer/);
    assert.equal(fixture.host.querySelectorAll("script").length, 0, "Email bodies are plain text, never executable HTML");
    assert.equal(fixture.host.querySelectorAll("article time").length, 1);
    await React.act(async () => { thread.open = false; thread.dispatchEvent(new Event("toggle")); thread.open = true; thread.dispatchEvent(new Event("toggle")); });
    assert.equal(fixture.requests.length, 1, "Reopening a row reuses the loaded exchange");
  } finally { await fixture.close(); }
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
