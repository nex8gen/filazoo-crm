import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { commerceDefaults } from "../lib/company-commerce.ts";
import { invoiceCurrencies } from "../lib/invoices.ts";
import * as followup from "../lib/company-followup.ts";
import type { CompanyDetails } from "../lib/types.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://crm.test/companies/acme", pretendToBeVisual: true });
for (const key of ["document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "SVGElement", "Element", "Node", "NodeFilter", "ShadowRoot", "DocumentFragment", "MutationObserver", "FormData", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: dom.window.requestAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: dom.window.cancelAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, window: dom.window, navigator: dom.window.navigator, FormData: dom.window.FormData, Event: dom.window.Event, requestAnimationFrame: globalThis.requestAnimationFrame, require: (name: string) => name.endsWith(".css") ? {} : dependencies[name] ?? require(name) });
  return exports as T;
}
const primitive = (tag: string) => function Primitive({ children, ...props }: Record<string, unknown>) {
  delete props.variant; delete props.size;
  return React.createElement(tag, props, children as React.ReactNode);
};
const button = { Button: primitive("button"), buttonVariants: () => "" };
const popover = load("components/ui/popover.tsx", {});
const fixture: CompanyDetails = {
  company: { id: "4913b683-bcec-4079-b424-6fd559ed0c2a", name: "Moab", initials: "M", ownerId: "owner", ownerName: "Terrianne", ownerInitials: "T", website: "", domain: "", country: "Brazil", city: "AM", segment: "Shopify B2B lead", source: "shopify", sourceLabel: "Shopify", paidOrderCount: 0, fitScore: 0, outreachStatus: "New", currency: "USD", nextFollowupAt: null, nextAction: "", tags: [], contact: "Moab De Souza Melo Filho", contactRole: "Role not confirmed", email: "moab1901@gmail.com", summary: "This company has not been profiled yet." },
  commerce: commerceDefaults({ address: "Billing office", shippingAddress: "Warehouse", email: "billing@example.com", currency: "EUR", termsDays: 30 }), contacts: [], activity: [],
};

async function mount(canWrite = true) {
  const calls: Array<{ companyId: string; patch: Record<string, unknown> }> = [];
  const schedules: Array<{ companyId: string; dueAt: string }> = [];
  const notices: string[] = [];
  let result: { success?: string; error?: string } = { success: "Saved" };
  let throws = false;
  let gate: Promise<void> | undefined;
  let release: () => void = () => {};
  let copied = "";
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  const deps: Record<string, unknown> = {
    "@/app/crm-actions": {
      updateCompanyFields: async (companyId: string, patch: Record<string, unknown>) => { calls.push({ companyId, patch: structuredClone(patch) }); if (gate) await gate; if (throws) throw new Error("offline"); return result; },
      scheduleCompanyFollowup: async (companyId: string, dueAt: string) => { schedules.push({ companyId, dueAt }); return result; },
    },
    "sonner": { toast: { success: (value: string) => notices.push(value), error: (value: string) => notices.push(value) } },
    "next/link": { default: primitive("a") },
    "@/components/ui/button": button,
    "@/components/ui/input": { Input: primitive("input") },
    "@/components/ui/textarea": { Textarea: primitive("textarea") },
    "@/components/ui/label": { Label: primitive("label") },
    "@/components/ui/popover": popover,
    "@/components/ui/date-picker": { DatePicker: ({ includeTime, onValueChange, ...props }: { includeTime?: boolean; onValueChange: (value: string) => void }) => React.createElement("input", { ...props, type: includeTime ? "datetime-local" : "date", onChange: (event: React.ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value) }) },
    "@/lib/company-followup": followup,
    "@/lib/company-commerce": { commerceDefaults },
    "@/lib/invoices": { invoiceCurrencies },
    "@/components/ui/select": {
      Select: ({ children, name, defaultValue }: { children: React.ReactNode; name: string; defaultValue: string }) => React.createElement("div", null, React.createElement("input", { type: "hidden", name, defaultValue }), children),
      SelectTrigger: primitive("div"), SelectValue: () => null, SelectContent: () => null, SelectItem: () => null,
    },
  };
  deps["@/components/company-profile-fields"] = load("components/company-profile-fields.tsx", deps);
  deps["@/components/company-followup-bar"] = load("components/company-followup-bar.tsx", deps);
  deps["@/components/company-commerce-fields"] = load("components/company-commerce-fields.tsx", deps);
  const { CompanyDetails: Component } = load<{ CompanyDetails: React.ComponentType<{ details: CompanyDetails; canWrite: boolean }> }>("components/company-details.tsx", deps);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = async (details = fixture) => { await React.act(async () => root.render(React.createElement(Component, { details, canWrite }))); };
  await render();
  return { calls, schedules, notices, render, copied: () => copied, fail: () => { result = { error: "Duplicate email" }; }, offline: () => { throws = true; }, succeed: () => { result = { success: "Saved" }; throws = false; }, defer: () => { gate = new Promise(resolve => { release = resolve; }); }, release: () => release(), close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

const click = async (selector: string) => { const element = document.querySelector<HTMLElement>(selector); assert.ok(element, selector); await React.act(async () => element.click()); };
const type = async (selector: string, value: string) => {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  assert.ok(element, selector);
  const prototype = element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  await React.act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
};
const submit = async (selector: string) => { await React.act(async () => document.querySelector(selector)!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); };

test("billing, shipping and notes are separate always-visible sections with readable values", async () => {
  const ui = await mount();
  try {
    assert.equal(document.querySelectorAll("details, summary").length, 0);
    const sections = [...document.querySelectorAll(".company-details-overview > .company-profile-section")];
    assert.equal(sections.length, 3);
    assert.deepEqual(sections.map(section => section.querySelector("h3")!.textContent), ["Billing details", "Shipping details", "Account notes"]);
    assert.match(sections[0].textContent!, /Billing office/);
    assert.match(sections[1].textContent!, /Warehouse/);
    assert.match(sections[2].textContent!, /Profile notes.*Add profile notes/);
    assert.equal(document.querySelector(".company-profile-section input, .company-profile-section textarea"), null);
    assert.equal(document.querySelector(".company-properties input"), null);
    assert.match(document.querySelector(".company-properties")!.textContent!, /Moab.*Website.*Add website/);
    assert.match(document.querySelector(".company-followup-bar")!.textContent!, /Not scheduled/);
    assert.equal(document.querySelector("form[aria-label='Edit Company name']"), null);
    assert.equal(ui.calls.length, 0);
  } finally { await ui.close(); }
});

test("inline save patches only the selected field and Escape cancels without saving or closing the panel", async () => {
  const ui = await mount();
  try {
    await click('[aria-label="Edit Company name"]');
    await type('input[name="name"]', "Draft name");
    let escaped = false;
    const onEscape = () => { escaped = true; };
    document.addEventListener("keydown", onEscape);
    await React.act(async () => document.querySelector("input[name=name]")!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    document.removeEventListener("keydown", onEscape);
    assert.equal(escaped, false);
    assert.equal(ui.calls.length, 0);
    assert.match(document.querySelector('[aria-label="Edit Company name"]')!.textContent!, /Moab/);
    await click('[aria-label="Edit City"]');
    await type('input[name="city"]', "  Manaus  ");
    await submit('form[aria-label="Edit City"]');
    assert.deepEqual(ui.calls, [{ companyId: fixture.company.id, patch: { city: "Manaus" } }]);
    assert.equal(document.querySelector('input[name="city"]'), null);
    assert.match(document.querySelector('[aria-label="Edit City"]')!.textContent!, /Manaus/);
  } finally { await ui.close(); }
});

test("failed and pending saves keep the draft, disable duplicate submissions, and allow retry", async () => {
  const ui = await mount();
  try {
    ui.fail();
    await click('[aria-label="Edit Business email"]');
    await type('input[name="contactEmail"]', "new@example.com");
    await submit('form[aria-label="Edit Business email"]');
    assert.equal(document.querySelector<HTMLInputElement>('input[name="contactEmail"]')!.value, "new@example.com");
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /Duplicate email/);
    assert.equal(ui.notices.length, 0);
    ui.succeed(); ui.defer();
    await submit('form[aria-label="Edit Business email"]');
    assert.equal(document.querySelector<HTMLInputElement>('input[name="contactEmail"]')!.disabled, true);
    assert.equal(document.querySelector<HTMLButtonElement>('[aria-label="Cancel Business email edit"]')!.disabled, true);
    await submit('form[aria-label="Edit Business email"]');
    assert.equal(ui.calls.length, 2);
    await React.act(async () => ui.release());
    assert.equal(document.querySelector('input[name="contactEmail"]'), null);
    assert.equal(ui.notices.length, 1);
  } finally { await ui.close(); }
});

test("network errors preserve edits without claiming success", async () => {
  const ui = await mount();
  try {
    ui.offline();
    await click('[aria-label="Add Website"]');
    await type('input[name="website"]', "example.com");
    await submit('form[aria-label="Edit Website"]');
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /still here/);
    assert.equal(document.querySelector<HTMLInputElement>('input[name="website"]')!.value, "example.com");
    assert.equal(ui.notices.length, 0);
  } finally { await ui.close(); }
});

test("refreshing follow-up data retains note drafts and saving notes patches only the edited field", async () => {
  const ui = await mount();
  try {
    await click('[aria-label="Add Profile notes"]');
    await type("textarea[name=summary]", "Unsaved buying preference");
    const input = document.querySelector("textarea[name=summary]");
    await ui.render({ ...fixture, company: { ...fixture.company, nextFollowupAt: "2026-12-01T01:00:00Z" } });
    assert.equal(document.querySelector("textarea[name=summary]"), input);
    assert.equal((input as HTMLTextAreaElement).value, "Unsaved buying preference");
    await submit('form[aria-label="Edit Profile notes"]');
    assert.deepEqual(ui.calls[0].patch, { summary: "Unsaved buying preference" });
  } finally { await ui.close(); }
});

test("billing and shipping fields patch independently and shipping can use the saved billing address", async () => {
  const ui = await mount();
  try {
    await click('[aria-label="Edit Billing address"]');
    await type("textarea[name='commerce.address']", "New office");
    await submit('form[aria-label="Edit Billing address"]');
    assert.deepEqual(ui.calls[0].patch, { commerce: { address: "New office" } });
    await ui.render({ ...fixture, commerce: { ...fixture.commerce!, address: "New office" } });
    await click('[aria-label="Edit Shipping address"]');
    await click('.company-inline-suggestion');
    assert.equal(document.querySelector<HTMLTextAreaElement>("textarea[name='commerce.shippingAddress']")!.value, "New office");
    await submit('form[aria-label="Edit Shipping address"]');
    assert.deepEqual(ui.calls[1].patch, { commerce: { shippingAddress: "New office" } });
  } finally { await ui.close(); }
});

test("payment terms, currency and qualification edits keep their server value types", async () => {
  const ui = await mount();
  try {
    await click('[aria-label="Edit Payment terms (days)"]');
    await type('input[name="commerce.termsDays"]', "45");
    await submit('form[aria-label="Edit Payment terms (days)"]');
    assert.deepEqual(ui.calls[0].patch, { commerce: { termsDays: 45 } });
    await click('[aria-label="Edit Default currency"]');
    const select = document.querySelector<HTMLSelectElement>('select[name="commerce.currency"]')!;
    await React.act(async () => { select.value = "GBP"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    await submit('form[aria-label="Edit Default currency"]');
    assert.deepEqual(ui.calls[1].patch, { commerce: { currency: "GBP" } });
    await click('[aria-label="Add Fit score (1–10)"]');
    await type('input[name="fitScore"]', "8");
    await submit('form[aria-label="Edit Fit score (1–10)"]');
    assert.deepEqual(ui.calls[2].patch, { fitScore: 8 });
    await click('[aria-label="Edit Fit score (1–10)"]');
    await type('input[name="fitScore"]', "");
    await submit('form[aria-label="Edit Fit score (1–10)"]');
    assert.deepEqual(ui.calls[3].patch, { fitScore: "" });
  } finally { await ui.close(); }
});

test("follow-up shortcuts save local 9 AM instants and custom dates can be saved or removed", async () => {
  const ui = await mount();
  try {
    await click('[data-slot="popover-trigger"]');
    const tomorrow = [...document.querySelectorAll<HTMLButtonElement>(".company-followup-options button")].find(item => item.textContent?.includes("Tomorrow"))!;
    await React.act(async () => tomorrow.click());
    const expected = new Date(); expected.setDate(expected.getDate() + 1); expected.setHours(9, 0, 0, 0);
    assert.deepEqual(ui.schedules[0], { companyId: fixture.company.id, dueAt: expected.toISOString() });
    assert.ok(document.querySelector(".company-followup-bar time"));
    await click('[data-slot="popover-trigger"]');
    const choose = [...document.querySelectorAll<HTMLButtonElement>(".company-followup-options button")].find(item => item.textContent?.includes("Choose date"))!;
    await React.act(async () => choose.click());
    await type('input[aria-label="Follow-up date and time"]', "2026-12-02T14:30");
    await submit(".company-followup-popover form");
    assert.equal(ui.schedules[1].dueAt, followup.followupInstant("2026-12-02T14:30"));
    await click('[data-slot="popover-trigger"]');
    const remove = [...document.querySelectorAll<HTMLButtonElement>(".company-followup-options button")].find(item => item.textContent?.includes("Remove follow-up"))!;
    await React.act(async () => remove.click());
    assert.equal(ui.schedules[2].dueAt, "");
    assert.match(document.querySelector(".company-followup-bar")!.textContent!, /Not scheduled/);
  } finally { await ui.close(); }
});

test("contact actions copy the email and open the existing compose flow; viewers have no write controls", async () => {
  const ui = await mount();
  try {
    await click('[aria-label="Copy business email"]');
    assert.equal(ui.copied(), fixture.company.email);
    assert.equal(document.querySelector('[aria-label="Compose email to primary contact"]')!.getAttribute("href"), `/companies/${fixture.company.id}?tab=email&compose=1`);
  } finally { await ui.close(); }
  const viewer = await mount(false);
  try {
    assert.equal(document.querySelector(".company-property-value"), null);
    assert.equal(document.querySelector('[data-slot="popover-trigger"]'), null);
    assert.equal(document.querySelector('button[type="submit"]'), null);
    assert.equal(document.querySelector("input, textarea, select"), null);
    assert.match(document.querySelector(".company-details-overview")!.textContent!, /Billing office.*Warehouse/);
    assert.equal(document.querySelector('[aria-label="Compose email to primary contact"]'), null);
    assert.equal(viewer.calls.length, 0);
  } finally { await viewer.close(); }
});
