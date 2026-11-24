import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import type { CampaignAudience, CampaignContactOption } from "../lib/email-campaigns.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "ShadowRoot"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
Object.defineProperty(globalThis, "getComputedStyle", { value: dom.window.getComputedStyle.bind(dom.window) });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: dom.window.requestAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: dom.window.cancelAnimationFrame.bind(dom.window) });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const h = React.createElement;
type Props = Record<string, unknown> & { children?: React.ReactNode };
const source = ts.transpileModule(readFileSync(new URL("../components/campaign-audience-select.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const audiences: CampaignAudience[] = [{ id: "all", name: "All contacts", kind: "all", count: 120 }, { id: "saved", name: "Saved audience", kind: "saved", count: 1, companyCount: 1 }, { id: "business:Shopify", name: "Shopify", kind: "business", count: 119 }];
const contacts: CampaignContactOption[] = Array.from({ length: 120 }, (_, i) => ({ id: `contact:${i}`, name: `Contact ${i}`, email: `buyer${i}@example.test`, companyName: "Acme", audienceIds: [i === 119 ? "saved" : "business:Shopify"], verificationStatus: "unverified", eligible: false, eligibilityStatus: "Unverified email", eligibilityReason: "This contact came from email history. Its address has not been verified for campaign sending." }));

async function mount(initialValue: string[] = [], data: { audiences?: CampaignAudience[]; contacts?: CampaignContactOption[]; disabled?: boolean } = {}) {
  let refreshes = 0;
  const changes: string[][] = [];
  const deps: Record<string, unknown> = {
    react: React,
    "@/components/ui/button": { Button: ({ children, ...props }: Props) => { delete props.size; delete props.variant; return h("button", props, children); } },

  };
  const exports = {} as { CampaignAudienceSelect: React.ComponentType<Props> };
  vm.runInNewContext(source, { exports, require: (name: string) => deps[name] ?? require(name), Set, Map });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const host = document.body;
  function Harness() {
    const [value, setValue] = React.useState(initialValue);
    return h(exports.CampaignAudienceSelect, { label: "Send to", options: data.audiences ?? audiences, contacts: data.contacts ?? contacts, value, onChange: (next: string[]) => { changes.push(next); setValue(next); }, onRefresh: () => refreshes++, disabled: data.disabled ?? false });
  }
  await React.act(async () => root.render(h(Harness)));
  const button = (name: string) => {
    const found = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === name || b.getAttribute("aria-label") === name);
    assert.ok(found, `Missing button: ${name}`); return found;
  };
  return { host, button, changes, refreshes: () => refreshes, click: async (name: string) => { await React.act(async () => button(name).click()); }, dispose: async () => { await React.act(async () => root.unmount()); container.remove(); } };
}

async function search(ui: { host: HTMLElement }, text: string) {
  const input = ui.host.querySelector('input[role="combobox"]') as HTMLInputElement;
  await React.act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("business segments are directly accessible and segment contacts can be inspected without selecting the audience", async () => {
  const ui = await mount();
  try {
    await ui.click("Show send to options"); assert.equal(ui.refreshes(), 1);
    await ui.click("Business 1");
    assert.equal(ui.host.querySelectorAll(".campaign-audience-row").length, 1);
    assert.match(ui.host.querySelector(".campaign-audience-row")!.textContent!, /Shopify/);
    await ui.click("Saved 1");
    await ui.click("View contacts in Saved audience");
    assert.equal(ui.host.querySelectorAll(".campaign-audience-contact").length, 1);
    assert.equal((ui.host.querySelector("select") as HTMLSelectElement).value, "saved");
    assert.match(ui.host.textContent!, /Contact 119/);
    assert.match(ui.host.textContent!, /Unverified email/);
    assert.match(ui.host.querySelector(".campaign-audience-reason")!.textContent!, /email history/);
    assert.deepEqual(ui.changes, []);
    await React.act(async () => (ui.host.querySelector('[role="option"]') as HTMLElement).click());
    assert.deepEqual(Array.from(ui.changes[0]), ["contact:119"]);
  } finally { await ui.dispose(); }
});

test("contact pagination exposes the full total and reaches every contact after the first 50", async () => {
  const ui = await mount();
  try {
    await ui.click("Show send to options");
    await ui.click("Contacts 120");
    assert.equal(ui.host.querySelectorAll(".campaign-audience-contact").length, 50);
    assert.match(ui.host.querySelector('[role="status"]')!.textContent!, /1–50 of 120 contacts/);
    assert.equal(ui.button("Previous").disabled, true);
    await ui.click("Next");
    assert.match(ui.host.querySelector('[role="status"]')!.textContent!, /51–100 of 120 contacts/);
    await ui.click("Next");
    assert.equal(ui.host.querySelectorAll(".campaign-audience-contact").length, 20);
    assert.match(ui.host.textContent!, /Contact 119/);
    assert.equal(ui.button("Next").disabled, true);
    await ui.click("Previous");
    assert.match(ui.host.querySelector('[role="status"]')!.textContent!, /51–100 of 120 contacts/);
    const select = ui.host.querySelector("select")!;
    await React.act(async () => { select.value = "saved"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    assert.match(ui.host.querySelector('[role="status"]')!.textContent!, /1–1 of 1 contacts/);
  } finally { await ui.dispose(); }
});

test("the main audience field is the only search input and preserves selections when searching and closing", async () => {
  const ui = await mount(["saved"]);
  try {
    const input = ui.host.querySelector('input[role="combobox"]') as HTMLInputElement;
    assert.equal(ui.host.querySelector(".campaign-audience-chip")!.textContent, "Saved audience");
    assert.equal(input.labels?.[0].textContent, "Send to");
    await ui.click("Show send to options");
    assert.equal(ui.host.querySelectorAll('input[role="combobox"]').length, 1);
    assert.equal(input.value, "");
    assert.equal(input.placeholder, "Search more segments or contacts");
    await ui.click("Contacts 120");
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    await React.act(async () => {
      input.focus();
      setValue.call(input, "buyer119@example.test");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(ui.host.querySelectorAll('[role="option"]').length, 1);
    assert.match(ui.host.querySelector('[role="option"]')!.textContent!, /Contact 119/);
    assert.deepEqual(ui.changes, [], "searching does not replace the selected audiences");
    await React.act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await React.act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    assert.deepEqual(Array.from(ui.changes.at(-1)!), ["saved", "contact:119"]);
    assert.equal(input.getAttribute("aria-expanded"), "true", "selecting a search result leaves the popup open");
    assert.equal(input.value, "", "selection clears the query for another search");
    assert.equal(document.activeElement, input);
    await React.act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.deepEqual([...ui.host.querySelectorAll(".campaign-audience-chip")].map(chip => chip.textContent), ["Saved audience", "buyer119@example.test"]);
    assert.deepEqual(Array.from(ui.changes.at(-1)!), ["saved", "contact:119"]);
    await ui.click("Show send to options");
    assert.equal(input.value, "", "reopening starts a fresh search");
    assert.equal(ui.host.querySelectorAll('input[role="combobox"]').length, 1);
  } finally { await ui.dispose(); }
});

test("live search ranks segments and contacts together, highlights each matching field and ignores every browse filter", async () => {
  const data = {
    audiences: [audiences[0], { ...audiences[1], name: "SOU" }, { ...audiences[2], name: "Partners for sou" }],
    contacts: [
      { ...contacts[0], id: "contact:name", name: "Sourav Mallick", email: "sourav@example.test", companyName: "Acme", audienceIds: ["business:Shopify"] },
      { ...contacts[1], id: "contact:email", name: "Buyer", email: "sou@example.test", companyName: "Acme", audienceIds: ["saved"] },
      { ...contacts[2], id: "contact:company", name: "Factory", email: "factory@example.test", companyName: "Sou Tools", audienceIds: ["business:Shopify"] },
    ],
  };
  const ui = await mount(["saved"], data);
  try {
    await ui.click("Show send to options");
    await ui.click("Saved 1");
    await search(ui, "sOu");
    const results = () => [...ui.host.querySelectorAll('[role="option"]')];
    assert.equal(results().length, 5);
    for (const [index, prefix] of ["SOU", "Sourav Mallick", "Buyer", "Factory", "Partners for sou"].entries()) assert.ok(results()[index].textContent!.startsWith(prefix));
    assert.equal(ui.host.querySelector(".campaign-audience-tabs"), null);
    assert.equal(ui.host.querySelector('[aria-label="Segment type"]'), null);
    assert.equal(ui.host.querySelector("select"), null);
    assert.deepEqual([...results()[1].querySelectorAll("mark")].map(mark => mark.textContent), ["Sou", "sou"]);
    assert.equal(results()[2].querySelector("small mark")!.textContent, "sou");
    assert.equal(results()[3].querySelector("small mark")!.textContent, "Sou");
    assert.deepEqual(ui.changes, [], "searching and ranking preserve selected audiences");
    await search(ui, "");
    assert.equal(ui.button("Saved 1").getAttribute("aria-pressed"), "true");
    assert.equal(results().length, 1);
    await ui.click("View contacts in SOU");
    assert.equal((ui.host.querySelector("select") as HTMLSelectElement).value, "saved");
    assert.equal(results().length, 1);
    await search(ui, "sou");
    assert.equal(results().length, 5, "a prior contact membership filter cannot hide global search results");
    await search(ui, "does not exist");
    assert.equal(results().length, 0);
    assert.match(ui.host.textContent!, /No matching segments or contacts/);
  } finally { await ui.dispose(); }
});

test("highlights literal punctuation, repeated matches and company text safely", async () => {
  const ui = await mount([], { contacts: [{ ...contacts[0], name: "<img src=x> [X].+ [x].+", companyName: "中文测试" }] });
  try {
    await ui.click("Show send to options");
    await search(ui, "[x].+");
    const result = ui.host.querySelector('[role="option"]')!;
    assert.deepEqual([...result.querySelectorAll("mark")].map(mark => mark.textContent), ["[X].+", "[x].+"]);
    assert.match(result.textContent!, /<img src=x>/);
    assert.equal(result.querySelector("img"), null);
    await search(ui, "中文");
    assert.equal(ui.host.querySelector('[role="option"] mark')!.textContent, "中文");
  } finally { await ui.dispose(); }
});

test("global matches paginate across the complete contact set and reset when the query changes", async () => {
  const ui = await mount();
  try {
    await ui.click("Show send to options");
    await ui.click("Business 1");
    await search(ui, "example.test");
    assert.equal(ui.host.querySelectorAll('[role="option"]').length, 50);
    assert.match(ui.host.querySelector('[role="status"]')!.textContent!, /1–50 of 120 matches/);
    await ui.click("Next");
    assert.match(ui.host.querySelector('[role="status"]')!.textContent!, /51–100 of 120 matches/);
    await search(ui, "buyer119@");
    assert.equal(ui.host.querySelectorAll('[role="option"]').length, 1);
    assert.match(ui.host.querySelector('[role="option"]')!.textContent!, /Contact 119/);
    assert.equal(ui.host.querySelector(".campaign-audience-pagination"), null);
  } finally { await ui.dispose(); }
});

test("searching and selecting repeatedly appends removable email chips and keeps the popup and input ready", async () => {
  const ui = await mount(["saved"]);
  try {
    await ui.click("Show send to options");
    const input = ui.host.querySelector('input[role="combobox"]') as HTMLInputElement;
    for (const index of [0, 1]) {
      await search(ui, `buyer${index}@`);
      const option = ui.host.querySelector('[role="option"]') as HTMLElement;
      await React.act(async () => {
        option.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
        option.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
        option.click();
      });
      assert.equal(input.getAttribute("aria-expanded"), "true");
      assert.equal(document.activeElement, input);
      assert.equal(input.value, "");
      assert.equal(ui.host.querySelectorAll(".campaign-audience-chip").length, index + 2);
    }
    assert.deepEqual([...ui.host.querySelectorAll(".campaign-audience-chip")].map(chip => chip.textContent), ["Saved audience", "buyer0@example.test", "buyer1@example.test"]);
    assert.deepEqual(Array.from(ui.changes.at(-1)!), ["saved", "contact:0", "contact:1"]);
    await ui.click("Remove buyer0@example.test");
    assert.deepEqual(Array.from(ui.changes.at(-1)!), ["saved", "contact:1"]);
    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement, input);
    await React.act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.deepEqual([...ui.host.querySelectorAll(".campaign-audience-chip")].map(chip => chip.textContent), ["Saved audience", "buyer1@example.test"], "chips remain visible after closing");
    await ui.click("Show send to options");
    await search(ui, "buyer1@");
    assert.equal(ui.host.querySelector('[role="option"]')!.getAttribute("aria-selected"), "true");
    await React.act(async () => (ui.host.querySelector('[role="option"]') as HTMLElement).click());
    assert.deepEqual(Array.from(ui.changes.at(-1)!), ["saved"], "unchecking an existing selection removes its chip without duplicating it");
    assert.equal(input.getAttribute("aria-expanded"), "true");
  } finally { await ui.dispose(); }
});

test("Delete removes a focused chip and Delete/Backspace in an empty search remove the last chip without affecting typed queries", async () => {
  const ui = await mount(["saved", "contact:0", "contact:1"]);
  try {
    const input = ui.host.querySelector('input[role="combobox"]') as HTMLInputElement;
    const chip = ui.host.querySelectorAll(".campaign-audience-chip")[1] as HTMLElement;
    await React.act(async () => chip.click());
    assert.equal(document.activeElement, chip);
    await React.act(async () => chip.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    assert.deepEqual(Array.from(ui.changes.at(-1)!), ["saved", "contact:1"]);
    await search(ui, "buyer");
    const before = ui.changes.length;
    await React.act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
    await React.act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    assert.equal(ui.changes.length, before, "deleting search text must not remove recipients");
    await search(ui, "");
    await React.act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    assert.deepEqual(Array.from(ui.changes.at(-1)!), ["saved"]);
    await React.act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
    assert.deepEqual(Array.from(ui.changes.at(-1)!), []);
    assert.equal(ui.host.querySelectorAll(".campaign-audience-chip").length, 0);
    await React.act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    assert.deepEqual(Array.from(ui.changes.at(-1)!), []);
  } finally { await ui.dispose(); }
});

test("disabled audience fields keep existing selections and prevent chip removal", async () => {
  const ui = await mount(["saved", "contact:0"], { disabled: true });
  try {
    const input = ui.host.querySelector('input[role="combobox"]') as HTMLInputElement;
    assert.equal(input.disabled, true);
    assert.equal(ui.button("Remove buyer0@example.test").getAttribute("aria-disabled"), "true");
    await ui.click("Remove buyer0@example.test");
    const chip = ui.host.querySelector(".campaign-audience-chip") as HTMLElement;
    await React.act(async () => chip.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    assert.deepEqual(ui.changes, []);
    assert.equal(ui.host.querySelectorAll(".campaign-audience-chip").length, 2);
  } finally { await ui.dispose(); }
});
