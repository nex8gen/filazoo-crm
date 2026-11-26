import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as designTools from "../lib/portal-design.ts";
import { portalPreviewData } from "../lib/portal-preview.ts";
import { formatMoney } from "../lib/invoices.ts";
import * as themeTools from "../lib/portal-themes.ts";
import * as domainTools from "../lib/portal-domains.ts";
import * as websiteTools from "../lib/portal-website-design.ts";
import * as blockTools from "../lib/portal-website-blocks.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/customer-portal" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const native = (tag: string) => function NativeControl({ children, ...props }: Record<string, unknown>) {
  const render = props.render as React.ReactElement | undefined;
  delete props.variant; delete props.size; delete props.nativeButton; delete props.render; delete props.fill; delete props.unoptimized;
  if (render) return React.cloneElement(render, props, children as React.ReactNode);
  return React.createElement(tag, props, children as React.ReactNode);
};
const controls = {
  "@/components/ui/dialog": { Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? React.createElement("div", { role: "dialog" }, children) : null, DialogContent: native("div"), DialogHeader: native("header"), DialogFooter: native("footer"), DialogTitle: native("h2"), DialogDescription: native("p") },
  "@/components/ui/card": { Card: native("div"), CardFooter: native("div"), CardHeader: native("div"), CardTitle: native("h2") },
  "@/components/ui/badge": { Badge: native("span") },
  "@/components/ui/label": { Label: native("label") },
  "@/components/ui/notification-toast": { NotificationToast: () => null },
  "@/components/portal-editor-select": { PortalEditorSelect: ({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) => React.createElement("select", { "aria-label": label, value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value) }, options.map(option => React.createElement("option", { key: option.value, value: option.value }, option.label))) },
  "@/components/ui/button": { Button: native("button") },
  "@/components/ui/input": { Input: native("input") },
  "@/components/ui/textarea": { Textarea: native("textarea") },
  "@/components/ui/switch": { Switch: ({ checked, onCheckedChange, ...props }: { checked: boolean; onCheckedChange: (value: boolean) => void }) => React.createElement("input", { ...props, type: "checkbox", checked, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onCheckedChange(event.target.checked) }) },
};
function load(file: string, deps: Record<string, unknown>) {
  const exports = {} as Record<string, React.ComponentType<Record<string, unknown>>>;
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, window, document, crypto, console, require: (name: string) => name.endsWith(".css") ? {} : deps[name] ?? controls[name as keyof typeof controls] ?? require(name) });
  return exports;
}
const { PortalLocalTime } = load("components/portal-local-time.tsx", {});
const { PortalExperience } = load("components/portal-experience.tsx", {
  "@/components/portal-local-time": { PortalLocalTime },
  "next/link": { default: native("a") },
  "next/image": { default: native("img") },
  "@/components/language-switcher": { LanguageSwitcher: () => React.createElement("button", null, "Language") },
  "@/components/invoice-paper": { InvoicePaper: () => React.createElement("div", null, "Invoice paper preview") },
  "@/lib/invoices": { formatMoney },
  "@/lib/customer-portal": { shipmentLabels: { in_transit: "In transit" } },
  "@/lib/portal-design": designTools,
  "@/lib/portal-themes": themeTools,
});
const websiteElements = load("components/portal-website-elements.tsx", {
  "next/image": { default: native("img") }, "@/lib/portal-website-blocks": blockTools,
});
const editorFields = load("components/portal-editor-fields.tsx", {});
const { PortalElementTree } = load("components/portal-element-tree.tsx", { "@/lib/portal-website-blocks": blockTools });
const { PortalElementSettings } = load("components/portal-element-settings.tsx", { "@/lib/portal-website-blocks": blockTools, "@/components/portal-editor-fields": editorFields });
const { PortalSectionAppearance } = load("components/portal-section-appearance.tsx", { "@/components/portal-editor-fields": editorFields });
const { PortalSectionLibrary } = load("components/portal-section-library.tsx", { "@/lib/portal-website-design": websiteTools, "@/lib/portal-website-blocks": blockTools });
const { PortalWebsite } = load("components/portal-website.tsx", {
  "next/image": { default: native("img") },
  "@/lib/portal-design": designTools,
  "@/lib/portal-website-design": websiteTools,
  "@/lib/portal-website-blocks": blockTools,
  "@/components/portal-website-elements": websiteElements,
});

test("custom domain settings connect, show DNS records, verify HTTPS, and require disconnect confirmation", async () => {
  const calls: string[] = [];
  let removalFails = true;
  const pending: domainTools.PortalDomain = { hostname: "portal.example.com", status: "pending_dns", records: [{ type: "TXT", name: "_filazoo-portal.portal.example.com", value: "proof" }, { type: "CNAME", name: "portal.example.com", value: "tenant.vercel-dns-017.com" }], checkedAt: null, message: null };
  const { PortalDomainSettings } = load("components/portal-domain-settings.tsx", {
    "next/link": { default: native("a") }, "@/lib/portal-domains": domainTools,
    "@/components/confirm-action-dialog": { ConfirmActionDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => open ? React.createElement("button", { onClick: onConfirm }, "Confirm disconnect") : null },
    "@/app/customer-portal/domains/actions": { updatePortalDomain: async (action: string) => { calls.push(action); if (action === "disconnect" && removalFails) return { error: "Please retry disconnecting.", domain: { ...pending, status: "disconnecting" } }; return { domain: action === "disconnect" ? null : { ...pending, status: action === "verify" ? "connected" : "pending_dns" } }; } },
  });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const click = async (text: string) => { const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text); assert.ok(button, text); await React.act(async () => button.click()); };
  try {
    await React.act(async () => root.render(React.createElement(PortalDomainSettings, { domain: null, hostingReady: true, canWrite: true })));
    const input = host.querySelector<HTMLInputElement>("#portal-custom-domain")!;
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "portal.example.com"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await React.act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(calls, ["connect"]); assert.equal(host.querySelectorAll("tbody tr").length, 2);
    await click("Check connection");
    assert.deepEqual(calls, ["connect", "verify"]); assert.equal(host.querySelector('a[href="https://portal.example.com"]')?.textContent, "Open portal");
    await click("Disconnect domain"); assert.equal(calls.length, 2);
    await click("Confirm disconnect"); assert.deepEqual(calls, ["connect", "verify", "disconnect"]); assert.ok(host.textContent?.includes("Disconnecting")); assert.ok(host.querySelector('[role="alert"]'));
    removalFails = false;
    await click("Disconnect domain"); await click("Confirm disconnect"); assert.ok(host.querySelector("#portal-custom-domain"));
  } finally { await React.act(async () => root.unmount()); host.remove(); }
});
async function mount(canWrite = true, options: { saveError?: string } = {}) {
  let state: designTools.PortalDesignView = { draft: designTools.defaultPortalDesign(), published: null, revision: 0, updatedAt: null, publishedAt: null };
  const calls: { publish: boolean; design: designTools.PortalDesign; revision: number }[] = [];
  const { PortalBuilder } = load("components/portal-builder.tsx", {
    "next/link": { default: native("a") },
    "@/components/portal-experience": { PortalExperience },
    "@/components/portal-website": { PortalWebsite },
    "@/components/portal-element-tree": { PortalElementTree },
    "@/components/portal-element-settings": { PortalElementSettings },
    "@/components/portal-section-appearance": { PortalSectionAppearance },
    "@/components/portal-section-library": { PortalSectionLibrary },
    "@/components/portal-editor-fields": editorFields,
    "@/lib/portal-website-blocks": blockTools,
    "@/lib/portal-website-design": websiteTools,
    "@/lib/portal-preview": { portalPreviewData },
    "@/lib/portal-design": designTools,
    "@/lib/portal-themes": themeTools,
    "@/app/customer-portal/actions": { updatePortalDesign: async (input: typeof calls[number]) => {
      calls.push(structuredClone(input));
      if (options.saveError) return { error: options.saveError };
      state = { draft: input.design, published: input.publish ? input.design : state.published, revision: input.revision + 1, updatedAt: "2026-11-16T08:00:00Z", publishedAt: input.publish ? "2026-11-16T08:00:00Z" : state.publishedAt };
      return { saved: state };
    } },
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(PortalBuilder, { initial: state, canWrite, workspaceName: "Test workspace" })));
  const button = (label: string) => {
    const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label || item.getAttribute("aria-label") === label);
    assert.ok(node, label); return node;
  };
  const click = async (label: string) => { await React.act(async () => button(label).click()); };
  return { host, button, click, calls, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}
async function editField(host: HTMLElement, selector: string | HTMLInputElement | HTMLTextAreaElement, value: string) {
  const node = typeof selector === "string" ? host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)! : selector;
  assert.ok(node, String(selector));
  const prototype = node.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  await React.act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function selectEditor(host: HTMLElement, label: string, value: string) {
  const node = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  assert.ok(node, label);
  await React.act(async () => { node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function toggleSetting(host: HTMLElement, text: string) {
  const label = [...host.querySelectorAll<HTMLLabelElement>("label")].find(item => item.textContent === text)!;
  assert.ok(label, text);
  const control = host.querySelector<HTMLInputElement>(`[id="${label.htmlFor}"]`)!;
  assert.ok(control, text);
  await React.act(async () => control.click());
}
async function clickElement(host: HTMLElement, section: string, id: string) {
  const button = host.querySelector<HTMLButtonElement>(`.pws-${section} [data-element-id="${id}"] > .pws-element-edit`)!;
  assert.ok(button, `${section} ${id}`);
  await React.act(async () => button.click());
}

test("individual heading edits, typography, section duplication and undo/redo persist independently", async () => {
  const ui = await mount();
  try {
    await clickElement(ui.host, "hero", "heading");
    await editField(ui.host, '[aria-label="Element text"]', "Materials for your business");
    await editField(ui.host, '[aria-label="Font size value"]', "44");
    await editField(ui.host, '[aria-label="Text color hex"]', "#123456");
    assert.equal(ui.host.querySelector(".pws-hero h1")?.textContent, "Materials for your business");
    assert.equal(ui.host.querySelector<HTMLElement>('.pws-hero [data-element-id="heading"]')?.style.fontSize, "44px");
    await ui.click("Back to section");
    await ui.click("Duplicate section");
    assert.equal(ui.host.querySelectorAll(".pws-hero").length, 2);
    await ui.click("Undo edit"); assert.equal(ui.host.querySelectorAll(".pws-hero").length, 1);
    await ui.click("Redo edit"); assert.equal(ui.host.querySelectorAll(".pws-hero").length, 2);
    await ui.click("Undo edit");
    await ui.click("Save");
    const section = ui.calls[0].design.website!.pages[0].sections[0];
    assert.equal(section.blocks?.find(item => item.id === "heading")?.text, "Materials for your business");
    assert.equal(section.blocks?.find(item => item.id === "heading")?.style?.fontSize, 44);
    assert.equal(section.blocks?.find(item => item.id === "heading")?.style?.color, "#123456");
    assert.equal(section.title, "Materials for your business");
    assert.equal(ui.button("Undo edit").disabled, true);
  } finally { await ui.close(); }
});

test("nested groups and their child headings can be added, duplicated and hidden without touching siblings", async () => {
  const ui = await mount();
  try {
    await ui.click("Explore our business");
    await clickElement(ui.host, "links", "page-links");
    await selectEditor(ui.host, "Nested element type", "group");
    await ui.click("Add nested element");
    await selectEditor(ui.host, "Nested element type", "heading");
    await ui.click("Add nested element");
    await editField(ui.host, '[aria-label="Element text"]', "Nested business heading");
    assert.ok(ui.host.querySelector(".pws-links")?.textContent?.includes("Nested business heading"));
    await ui.click("Duplicate element");
    await editField(ui.host, '[aria-label="Element text"]', "Hidden nested heading");
    await toggleSetting(ui.host, "Visible element");
    assert.equal(ui.host.querySelector(".pws-links")?.textContent?.includes("Hidden nested heading"), false);
    assert.ok(ui.host.querySelector(".pws-links")?.textContent?.includes("Nested business heading"));
    assert.ok(ui.host.querySelector(".pws-links")?.textContent?.includes("About us"));
    await ui.click("Save");
    const design = ui.calls[0].design;
    assert.equal(designTools.portalDesignSchema.safeParse(design).success, true);
    assert.ok(JSON.stringify(design).includes("Hidden nested heading"));
    assert.equal(JSON.stringify(websiteTools.publicWebsiteDesign(design)).includes("Hidden nested heading"), false);
  } finally { await ui.close(); }
});

test("section library, FAQ content and slideshow elements update the live preview", async () => {
  const ui = await mount();
  try {
    await ui.click("Browse sections");
    await editField(ui.host, '[aria-label="Search sections"]', "FAQ");
    assert.equal(ui.host.querySelectorAll(".pb-library-options > button").length, 1);
    await ui.click("Add FAQ / accordion");
    assert.equal(ui.host.querySelectorAll(".pws-faq-item").length, 3);
    await clickElement(ui.host, "faq", "question-1");
    await editField(ui.host, '[aria-label="Element name"]', "What is the minimum order?");
    await editField(ui.host, '[aria-label="Element text"]', "Contact **our team** for details.");
    assert.ok(ui.host.querySelector(".pws-faq-item summary")?.textContent?.includes("What is the minimum order?"));
    assert.equal(ui.host.querySelector(".pws-faq-item strong")?.textContent, "our team");
    await ui.click("Browse sections");
    await editField(ui.host, '[aria-label="Search sections"]', "Slideshow");
    await ui.click("Add Slideshow");
    assert.equal(ui.host.querySelectorAll('[aria-roledescription="slide"]').length, 2);
    await ui.click("Next slide");
    const slides = [...ui.host.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]')];
    assert.equal(slides[0].hidden, true); assert.equal(slides[1].hidden, false);
    await selectEditor(ui.host, "Nested element type", "heading");
    await ui.click("Add nested element");
    await editField(ui.host, '[aria-label="Element text"]', "Second slide headline");
    assert.ok(slides[1].textContent?.includes("Second slide headline"));
    await ui.click("Save");
    assert.equal(designTools.portalDesignSchema.safeParse(ui.calls[0].design).success, true);
  } finally { await ui.close(); }
});

test("product card media, safe button links and colors are retained by the published renderer", async () => {
  const ui = await mount();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await selectEditor(ui.host, "Section type", "products"); await ui.click("Add section");
    await clickElement(ui.host, "products", "card-1-image");
    await editField(ui.host, '[aria-label="Element image URL"]', "https://cdn.example.com/product.png");
    await editField(ui.host, '[aria-label="Image alternative text"]', "Filament spool");
    await selectEditor(ui.host, "Image shape", "natural");
    assert.ok(ui.host.querySelector('.pws-products img[alt="Filament spool"]'));
    await clickElement(ui.host, "products", "card-1-button");
    await editField(ui.host, '[aria-label="Element text"]', "Request a quote");
    await editField(ui.host, '[aria-label="Element link"]', "https://example.com/quote");
    await selectEditor(ui.host, "Element button style", "outline");
    await editField(ui.host, '[aria-label="Background color hex"]', "#123456");
    await editField(ui.host, '[aria-label="Text color hex"]', "#ffffff");
    await toggleSetting(ui.host, "Open in a new tab");
    await ui.click("Save");
    const design = ui.calls[0].design;
    await React.act(async () => root.render(React.createElement(PortalWebsite, { design: websiteTools.publicWebsiteDesign(design) })));
    const link = host.querySelector<HTMLAnchorElement>('.pws-products a[href="https://example.com/quote"]')!;
    assert.equal(link.textContent, "Request a quote");
    assert.equal(link.target, "_blank"); assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.style.backgroundColor, "rgb(18, 52, 86)"); assert.equal(link.style.color, "rgb(255, 255, 255)");
    assert.ok(host.querySelector('img[alt="Filament spool"]'));
    assert.equal(host.querySelector(".pws-element-edit"), null);
  } finally { await ui.close(); await React.act(async () => root.unmount()); host.remove(); }
});

test("header branding, account link, navigation and footer elements can be changed independently", async () => {
  const ui = await mount();
  try {
    await ui.click("Logo & brand");
    await toggleSetting(ui.host, "Show brand name");
    assert.equal(ui.host.querySelector(".pws-header strong"), null);
    await toggleSetting(ui.host, "Show brand name");
    await editField(ui.host, '.pb-panel input[type="url"]', "https://cdn.example.com/logo.png");
    assert.ok(ui.host.querySelector('.pws-header img[alt="Filazoo"]'));
    const accountLabel = [...ui.host.querySelectorAll<HTMLLabelElement>(".pb-panel label")].find(label => label.textContent === "Customer account label")!;
    await editField(ui.host, accountLabel.querySelector<HTMLInputElement>("input")!, "My account");
    assert.equal(ui.host.querySelector(".pws-account span")?.textContent, "My account");
    await ui.click("Add menu link");
    await editField(ui.host, '[aria-label="Menu link 4 label"]', "Support");
    await editField(ui.host, '[aria-label="Menu link 4 destination"]', "https://support.example.com");
    assert.ok(ui.host.querySelector('.pws-header nav a[href="https://support.example.com"]'));
    const menu = ui.host.querySelectorAll(".pb-menu-item")[3];
    const hide = [...menu.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Hide link")!;
    await React.act(async () => hide.click());
    assert.equal(ui.host.querySelector('.pws-header nav a[href="https://support.example.com"]'), null);
    await ui.click("Footer");
    await toggleSetting(ui.host, "Footer navigation");
    assert.ok(ui.host.querySelector('.pws-footer nav[aria-label="Footer navigation"]'));
    await toggleSetting(ui.host, "Footer brand name");
    assert.equal(ui.host.querySelector(".pws-footer > strong"), null);
    await ui.click("Save");
    const design = ui.calls[0].design;
    assert.equal(design.website?.header?.accountLabel, "My account");
    assert.equal(design.website?.footer?.showNavigation, true);
    assert.equal(designTools.portalDesignSchema.safeParse(design).success, true);
    assert.equal(JSON.stringify(websiteTools.publicWebsiteDesign(design)).includes("support.example.com"), false);
  } finally { await ui.close(); }
});

test("builder previews styles and devices and saves a draft separately from publishing", async () => {
  const ui = await mount();
  try {
    const inspector = ui.host.querySelector<HTMLSelectElement>('[aria-label="Editor settings"]')!;
    await React.act(async () => { inspector.value = "theme"; inspector.dispatchEvent(new Event("change", { bubbles: true })); });
    const style = [...ui.host.querySelectorAll<HTMLSelectElement>("select")].find(select => [...select.options].some(option => option.value === "soft"))!;
    await React.act(async () => { style.value = "soft"; style.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(ui.host.querySelector(".portal-website")?.getAttribute("data-theme"), "soft");
    await ui.click("Mobile preview");
    assert.ok(ui.host.querySelector(".pb-device-mobile"));
    await ui.click("Save");
    assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].publish, false); assert.equal(ui.calls[0].design.theme, "soft");
    assert.ok(ui.host.textContent?.includes("Theme saved."));
    await ui.click("Publish");
    assert.equal(ui.calls.length, 1);
    await ui.click("Publish theme");
    assert.equal(ui.calls.length, 2); assert.equal(ui.calls[1].publish, true); assert.equal(ui.calls[1].revision, 1);
    assert.equal(ui.button("Publish").disabled, true);
  } finally { await ui.close(); }
});

test("page dropdown, visibility, custom pages and messaging permissions update the actual customer app", async () => {
  const ui = await mount();
  try {
    const pagePicker = ui.host.querySelector<HTMLSelectElement>('[aria-label="Select portal page"]')!;
    await React.act(async () => { pagePicker.value = "billing"; pagePicker.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.ok(ui.host.querySelector(".cpa-invoice-balance"));
    assert.equal(ui.host.querySelector(".cpa-metrics"), null);
    const invoiceToggle = ui.host.querySelector<HTMLInputElement>("#pb-page-visible")!;
    await React.act(async () => invoiceToggle.click());
    assert.equal(ui.host.querySelector(".cpa-invoice-balance"), null);
    assert.ok(ui.host.querySelector(".cpa-unavailable"));
    const settings = ui.host.querySelector<HTMLSelectElement>('[aria-label="Editor settings"]')!;
    await React.act(async () => { settings.value = "pages"; settings.dispatchEvent(new Event("change", { bubbles: true })); });
    await ui.click("Add account page");
    assert.ok(ui.host.querySelector(".cpa-content-page"));
    await ui.click("Remove this page");
    assert.equal(ui.host.querySelector(".cpa-content-page"), null);
    await React.act(async () => { pagePicker.value = "messages"; pagePicker.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.ok(ui.host.querySelector(".cpa-chat"));
    const inspector = ui.host.querySelector<HTMLSelectElement>('[aria-label="Editor settings"]')!;
    await React.act(async () => { inspector.value = "features"; inspector.dispatchEvent(new Event("change", { bubbles: true })); });
    const messageToggle = ui.host.querySelector<HTMLInputElement>("#pb-feature-sendMessages")!;
    await React.act(async () => messageToggle.click());
    assert.equal(ui.host.querySelector(".cpa-demo-composer"), null);
    assert.ok(ui.host.querySelector(".portal-conversation")?.textContent?.includes("Hi Alex!"));
    await ui.click("Save");
    assert.equal(ui.calls[0].design.features.sendMessages, false);
    assert.equal(ui.calls[0].design.sections.find(s => s.type === "invoice")?.enabled, false);
  } finally { await ui.close(); }
});

test("read-only workspace members can inspect the preview without editing or publishing", async () => {
  const ui = await mount(false);
  try {
    assert.equal(ui.button("Save").disabled, true);
    assert.equal(ui.button("Publish").disabled, true);
    assert.equal(ui.host.querySelector("fieldset")?.disabled, true);
    await ui.click("Mobile preview"); assert.ok(ui.host.querySelector(".pb-device-mobile"));
    assert.equal(ui.calls.length, 0);
  } finally { await ui.close(); }
});

test("website is the starting page and its sections, account pages and saved content stay separate", async () => {
  const ui = await mount();
  const choose = async (label: string, value: string) => {
    const select = ui.host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    await React.act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  const input = async (selector: string, value: string) => {
    const node = ui.host.querySelector<HTMLInputElement>(selector)!;
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  try {
    assert.ok(ui.host.querySelector(".portal-website .pws-hero"));
    assert.equal(ui.host.querySelector(".cpa-sidebar"), null);
    const picker = ui.host.querySelector<HTMLSelectElement>('select[aria-label="Select portal page"]')!;
    assert.equal(picker.value, "website/home");
    for (const id of ["website/home", "website/pages/about", "website/pages/contact", "home", "orders", "billing", "messages"]) assert.ok([...picker.options].some(option => option.value === id), id);
    assert.ok(ui.host.querySelector('[aria-label="Portal structure"]')?.textContent?.includes("Template"));
    assert.equal(ui.host.querySelector('[aria-label="Portal structure"]')?.textContent?.includes("Orders"), false);
    await input('[aria-label="Section heading"]', "Made for your next project");
    assert.equal(ui.host.querySelector(".pws-hero h1")?.textContent, "Made for your next project");
    await ui.click("Hide Made for your next project");
    assert.equal(ui.host.querySelector(".pws-hero"), null);
    await ui.click("Show Made for your next project");
    await choose("Section type", "image");
    await ui.click("Add section");
    assert.ok(ui.host.querySelector(".pws-image"));
    await ui.click("Remove section");
    assert.equal(ui.host.querySelector(".pws-image"), null);
    await ui.click("Page settings");
    await ui.click("Manage website pages");
    await ui.click("Add website page");
    assert.equal(picker.options.length, 8);
    assert.ok(ui.host.querySelector(".portal-website .pws-text"));
    await ui.click("Remove this page");
    assert.equal(picker.value, "website/home");
    await choose("Select portal page", "home");
    assert.ok(ui.host.querySelector(".cpa-sidebar"));
    assert.ok(ui.host.querySelector(".cpa-metrics"));
    assert.equal(ui.host.querySelector(".portal-website"), null);
    await ui.click("Back to website");
    assert.equal(picker.value, "website/home");
    await ui.click("Save");
    assert.equal(ui.calls[0].design.website?.pages[0].sections[0].title, "Made for your next project");
    assert.equal(ui.calls[0].design.heading, "");
    assert.equal(ui.calls[0].design.sections.length, 4);
  } finally { await ui.close(); }
});

test("compact editor views switch between sections, preview and settings without losing the selected page", async () => {
  const previous = dom.window.matchMedia;
  Object.defineProperty(dom.window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  const ui = await mount();
  const view = () => ui.host.querySelector(".pb-workbench")?.getAttribute("data-mobile-panel");
  try {
    assert.equal(view(), "preview");
    await ui.click("Sections");
    assert.equal(view(), "sections");
    await ui.click("Header");
    assert.equal(view(), "settings");
    await ui.click("Close editor settings");
    assert.equal(view(), "preview");
    await ui.click("Settings");
    assert.ok(ui.host.querySelector('[aria-label="Theme editor settings"]'));
    assert.equal(view(), "settings");
    await ui.click("Preview");
    await ui.click("Toggle sections");
    assert.equal(view(), "sections");
    await ui.click("Theme settings");
    assert.equal(view(), "settings");
    assert.equal(ui.host.querySelector<HTMLSelectElement>('select[aria-label="Editor settings"]')?.value, "theme");
    assert.equal(ui.host.querySelector<HTMLSelectElement>('select[aria-label="Select portal page"]')?.value, "website/home");
    assert.equal(ui.calls.length, 0);
  } finally {
    await ui.close();
    Object.defineProperty(dom.window, "matchMedia", { configurable: true, value: previous });
  }
});

test("customer app uses separate page links, sidebar navigation, and mobile navigation instead of section tabs", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const design = designTools.defaultPortalDesign();
  try {
    await React.act(async () => root.render(React.createElement(PortalExperience, { data: portalPreviewData(design), invoiceId: "customer-id", page: "home" })));
    assert.ok(host.querySelector('.cpa-sidebar a[href="/customer/invoices/customer-id/orders"]'));
    assert.ok(host.querySelector('.cpa-mobile-nav a[href="/customer/invoices/customer-id/messages"]'));
    assert.equal(host.querySelector('[role="tablist"]'), null);
    assert.equal(host.querySelector(".cpa-chat"), null);
    await React.act(async () => root.render(React.createElement(PortalExperience, { data: portalPreviewData(design), invoiceId: "customer-id", page: "orders" })));
    assert.ok(host.querySelector(".cpa-order-steps"));
    assert.ok(host.textContent?.includes("DEMO-2048"));
    assert.equal(host.querySelector(".cpa-metrics"), null);
    assert.equal(host.querySelector(".cpa-chat"), null);
    assert.ok(host.querySelector('.cpa-sidebar a[aria-current="page"][href$="/orders"]'));
  } finally { await React.act(async () => root.unmount()); host.remove(); }
});

test("theme library separates the live theme, saved drafts and templates and persists additions before editing", async () => {
  let state: designTools.PortalDesignView = { draft: designTools.defaultPortalDesign(), published: null, revision: 0, updatedAt: null, publishedAt: null };
  const adds: string[] = [];
  const publishes: string[] = [];
  const changes: string[] = [];
  let failChange = false;
  const { PortalThemeArtwork } = load("components/portal-theme-artwork.tsx", { "@/lib/portal-design": designTools, "@/lib/portal-design-defaults": designTools, "@/lib/portal-website-design": websiteTools, "@/lib/portal-website-blocks": blockTools });
  const dialogParts = { Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? React.createElement("div", null, children) : null,
    DialogContent: native("div"), DialogHeader: native("header"), DialogFooter: native("footer"), DialogTitle: native("h2"), DialogDescription: native("p") };
  const { PortalThemePreview } = load("components/portal-theme-preview.tsx", {
    "next/dynamic": { default: () => PortalExperience }, "@/components/ui/dialog": dialogParts,
    "@/components/portal-website": { PortalWebsite }, "@/lib/portal-preview": { portalPreviewData }, "@/lib/portal-themes": themeTools, "@/lib/portal-website-design": websiteTools,
  });
  const { PortalLibraryDialog } = load("components/portal-library-dialog.tsx", { "@/components/ui/dialog": dialogParts });
  const menuParts = {
    DropdownMenu: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) => {
      const items = React.Children.toArray(children);
      return React.createElement("div", null, React.cloneElement(items[0] as React.ReactElement<{ onClick: () => void }>, { onClick: () => onOpenChange(!open) }), open ? items.slice(1) : null);
    },
    DropdownMenuTrigger: native("button"), DropdownMenuContent: native("div"), DropdownMenuItem: native("button"), DropdownMenuSeparator: native("hr"),
  };
  const { PortalThemeMenu } = load("components/portal-theme-menu.tsx", { "@/components/ui/dropdown-menu": menuParts });
  const { PortalThemeLibrary } = load("components/portal-theme-library.tsx", {
    "next/link": { default: native("a") }, "next/navigation": { useRouter: () => ({ refresh() {} }) }, "next/dynamic": { default: (loader: () => unknown) => loader.toString().includes("portal-library-dialog") ? PortalLibraryDialog : loader.toString().includes("portal-theme-menu") ? PortalThemeMenu : PortalThemePreview }, "@/components/ui/dialog": dialogParts,
    "@/components/ui/dropdown-menu": { DropdownMenu: native("div"), DropdownMenuTrigger: native("button"), DropdownMenuContent: native("div"), DropdownMenuItem: native("button"), DropdownMenuSeparator: native("hr") },
    "@/components/portal-local-time": { PortalLocalTime },
    "@/components/portal-theme-artwork": { PortalThemeArtwork }, "@/components/portal-experience": { PortalExperience },
    "@/components/portal-website": { PortalWebsite },
    "@/lib/portal-design": designTools, "@/lib/portal-themes": themeTools, "@/lib/portal-theme-model": themeTools, "@/lib/portal-domains": domainTools, "@/lib/portal-domain-status": { portalDomainLabels: domainTools.portalDomainLabels }, "@/lib/portal-preview": { portalPreviewData },
    "@/app/customer-portal/actions": {
      createPortalTheme: async ({ templateId }: { templateId: string }) => {
        adds.push(templateId); const id = `saved-${templateId}`;
        const theme = { id, name: themeTools.portalTemplates.find(item => item.id === templateId)!.name, design: themeTools.createPortalTemplate(templateId), updatedAt: null };
        state = { ...state, revision: state.revision + 1, themes: [...themeTools.portalLibraryThemes(state), theme] };
        return { saved: state, themeId: id };
      },
      publishPortalTheme: async ({ themeId }: { themeId: string }) => {
        publishes.push(themeId); const theme = state.themes!.find(item => item.id === themeId)!;
        state = { ...state, revision: state.revision + 1, published: theme.design, liveThemeId: themeId, publishedAt: "2026-11-16T10:00:00Z" };
        return { saved: state };
      },
      changePortalTheme: async ({ action, themeId, name }: { action: string; themeId: string; name?: string }) => {
        if (failChange) return { error: "Unable to save. Please retry." };
        changes.push(action);
        state = { ...state, revision: state.revision + 1, themes: state.themes!.filter(item => action !== "remove" || item.id !== themeId).map(item => item.id !== themeId ? item : action === "rename" ? { ...item, name: name! } : { ...item, design: state.published! }) };
        return { saved: state };
      },
    },
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(React.createElement(PortalThemeLibrary, { initial: state, canWrite: true, workspaceName: "Test brand" })));
    assert.ok(host.querySelector(".ptl-unpublished"));
    assert.equal(host.querySelector(".ptl-live-card"), null);
    assert.equal(host.querySelectorAll(".ptl-template-card").length, 0);
    assert.equal(host.querySelector(".portal-builder"), null);
    const click = async (label: string) => { const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label || item.getAttribute("aria-label") === label); assert.ok(button, label); await React.act(async () => button.click()); };
    await click("Add theme");
    assert.equal(host.querySelectorAll(".ptl-template-card").length, 6);
    const studio = [...host.querySelectorAll(".ptl-template-card")].find(card => card.textContent?.includes("Studio"))!;
    await React.act(async () => studio.querySelector<HTMLButtonElement>(".ptl-template-actions button:last-child")!.click());
    assert.deepEqual(adds, ["studio"]);
    assert.ok(host.querySelector('a[href="/customer-portal/themes/saved-studio"]'));
    const row = [...host.querySelectorAll(".ptl-draft-card")].find(item => item.textContent?.includes("Studio"))!;
    const publish = [...row.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Publish")!;
    await React.act(async () => publish.click());
    assert.deepEqual(publishes, []);
    await click("Publish theme");
    assert.deepEqual(publishes, ["saved-studio"]);
    assert.ok(host.querySelector(".ptl-live-info h3")?.textContent?.includes("Studio"));
    assert.equal(host.querySelector(".ptl-unpublished"), null);
    assert.equal(host.querySelectorAll(".ptl-draft-card").length, 1);
    await click("More actions for Studio");
    await click("Rename");
    await editField(host, ".ptl-name-field input", "Showcase");
    failChange = true;
    await React.act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.ok(host.querySelector('[role="alert"]')?.textContent?.includes("retry"));
    assert.equal(host.querySelector<HTMLInputElement>(".ptl-name-field input")?.value, "Showcase");
    assert.deepEqual(changes, []);
    failChange = false;
    await React.act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(changes, ["rename"]);
    assert.equal(host.querySelector(".ptl-live-info h3")?.textContent, "Showcase");
    state = { ...state, revision: state.revision + 1, themes: state.themes!.map(item => item.id === state.liveThemeId ? { ...item, design: { ...item.design, heading: "Unpublished" } } : item) };
    await React.act(async () => root.render(React.createElement(PortalThemeLibrary, { initial: state, canWrite: true, workspaceName: "Test brand" })));
    assert.ok(host.textContent?.includes("Unpublished changes"));
    await click("More actions for Showcase");
    await click("Restore published version");
    assert.deepEqual(changes, ["rename"]);
    await React.act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(changes, ["rename", "restore"]);
    assert.equal(host.textContent?.includes("Unpublished changes"), false);
    await click("More actions for My customer portal");
    await click("Remove draft");
    assert.deepEqual(changes, ["rename", "restore"]);
    await React.act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(changes, ["rename", "restore", "remove"]);
    assert.equal(host.querySelectorAll(".ptl-draft-card").length, 0);
    assert.ok(host.querySelector(".ptl-empty-drafts"));
    await click("Browse templates");
    await React.act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Preview Bloom template"]')!.click());
    assert.ok(host.querySelector(".ptl-preview-frame .portal-website"));
    await click("Mobile preview");
    assert.equal(host.querySelector(".ptl-preview-frame")?.getAttribute("data-device"), "mobile");
    assert.equal(host.querySelector(".ptl-preview-frame .cpa-sidebar"), null);
    await React.act(async () => host.querySelector<HTMLButtonElement>(".ptl-preview-frame .pws-account")!.click());
    assert.ok(host.querySelector(".ptl-preview-frame .cpa-metrics"));
    const orderLink = [...host.querySelectorAll<HTMLButtonElement>(".ptl-preview-frame .cpa-sidebar button")].find(button => button.textContent === "Orders")!;
    await React.act(async () => orderLink.click());
    assert.ok(host.querySelector(".ptl-preview-frame .cpa-order-steps"));
    assert.equal(host.querySelector(".ptl-preview-frame .cpa-metrics"), null);
    await click("Close preview");
    assert.equal(host.querySelectorAll(".ptl-template-card").length, 6);
    await React.act(async () => root.render(React.createElement(PortalThemeLibrary, { initial: state, canWrite: false, workspaceName: "Test brand" })));
    assert.equal([...host.querySelectorAll<HTMLButtonElement>("button")].some(button => button.textContent?.trim() === "Publish" || button.textContent?.trim() === "Add theme" || button.textContent?.trim() === "Rename"), false);
    assert.ok(host.textContent?.includes("preview access"));
  } finally { await React.act(async () => root.unmount()); host.remove(); }
});


test("section fields keep working after element edits and copied elements keep independent content", async () => {
  const ui = await mount();
  try {
    await clickElement(ui.host, "hero", "heading");
    await editField(ui.host, '[aria-label="Element text"]', "Original headline");
    await ui.click("Duplicate element");
    await editField(ui.host, '[aria-label="Element text"]', "Independent headline");
    await ui.click("Back to section");
    await editField(ui.host, '[aria-label="Section heading"]', "Revised headline");
    assert.equal(ui.host.querySelector('.pws-hero [data-element-id="heading"] h1')?.textContent, "Revised headline");
    assert.ok(ui.host.querySelector('.pws-hero')?.textContent?.includes("Independent headline"));
    await ui.click("Duplicate section");
    assert.deepEqual([...ui.host.querySelectorAll('.pws-hero h1')].map(node => node.textContent), ["Revised headline", "Independent headline", "Revised headline", "Independent headline"]);
    await editField(ui.host, '[aria-label="Section name"]', "Alternate hero");
    assert.equal(ui.host.querySelectorAll('.pws-hero')[1].querySelector("h1")?.textContent, "Revised headline");
    assert.ok(ui.button("Alternate hero"));
    await ui.click("Save");
    const copied = ui.calls[0].design.website!.pages[0].sections[1];
    assert.equal(copied.name, "Alternate hero");
    assert.equal(copied.title, "Revised headline");
    assert.equal(copied.blocks?.find(block => block.text === "Independent headline")?.binding, undefined);
    await clickElement(ui.host, "hero", "heading");
    await ui.click("Remove element");
    assert.equal(ui.host.querySelector('[aria-label="Section heading"]'), null);
  } finally { await ui.close(); }
});

test("all section presets expose working section content controls and interactive preview follows edited links", async () => {
  const ui = await mount();
  try {
    for (const preset of websiteTools.websiteSectionTypes) {
      await selectEditor(ui.host, "Section type", preset.value); await ui.click("Add section");
      const section = [...ui.host.querySelectorAll<HTMLElement>('.pws-' + preset.value)].at(-1)!;
      assert.ok(section, preset.label);
      const heading = ui.host.querySelector<HTMLInputElement>('[aria-label="Section heading"]');
      if (preset.value === "spacer") assert.equal(heading, null);
      else { assert.ok(heading); await editField(ui.host, heading, "Custom " + preset.label); assert.ok(section.textContent?.includes("Custom " + preset.label)); }
      if (["contact", "links", "columns", "gallery", "faq", "testimonials", "statistics", "logos", "products", "video", "spacer"].includes(preset.value)) assert.equal(ui.host.querySelector('[aria-label="Section button label"]'), null, preset.label);
      if (preset.value === "slideshow") {
        assert.equal(ui.host.querySelector('[aria-label="Section image URL"]'), null);
        await clickElement(ui.host, "slideshow", "slide-2-heading");
        await editField(ui.host, '[aria-label="Element text"]', "Independent slide");
        await ui.click("Back to section");
        await editField(ui.host, '[aria-label="Section heading"]', "First slide headline");
        await editField(ui.host, '[aria-label="Section button label"]', "Read our story");
        await selectEditor(ui.host, "Button destination", "pages/about");
        assert.ok(section.textContent?.includes("First slide headline"));
        assert.ok(section.textContent?.includes("Independent slide"));
      }
    }
    await ui.click("Interact with preview");
    assert.equal(ui.host.querySelector('.pws-element-edit'), null);
    await ui.click("Read our story");
    assert.equal(ui.host.querySelector<HTMLSelectElement>('[aria-label="Select portal page"]')?.value, "website/pages/about");
    await ui.click("Customer account");
    assert.ok(ui.host.querySelector('.cpa-sidebar'));
    await ui.click("Return to editing");
    await selectEditor(ui.host, "Select portal page", "website/home");
    assert.ok(ui.host.querySelector('.pws-element-edit'));
    await ui.click("Save");
    assert.equal(designTools.portalDesignSchema.safeParse(ui.calls[0].design).success, true);
  } finally { await ui.close(); }
});

test("brand, email and page cards stay live after nested edits, with manual content overrides preserved", async () => {
  const ui = await mount();
  const brandInput = () => [...ui.host.querySelectorAll('label')].find(label => label.textContent === "Brand name")!.querySelector<HTMLInputElement>('input')!;
  try {
    await clickElement(ui.host, "hero", "heading"); await editField(ui.host, '[aria-label="Element padding value"]', "4");
    await clickElement(ui.host, "contact", "email"); await editField(ui.host, '[aria-label="Element padding value"]', "8");
    await ui.click("Theme settings");
    await editField(ui.host, brandInput(), "Wholesale Works");
    await editField(ui.host, '.pb-panel input[type="email"]', "team@example.com");
    assert.equal(ui.host.querySelector('.pws-eyebrow')?.textContent, "Wholesale Works · Business to business");
    assert.ok(ui.host.querySelector('.pws-contact [data-element-id="email"]')?.textContent?.includes("team@example.com"));
    await clickElement(ui.host, "hero", "eyebrow"); await editField(ui.host, '[aria-label="Element text"]', "Built for business");
    await clickElement(ui.host, "contact", "email"); await editField(ui.host, '[aria-label="Element text"]', "Contact sales");
    await ui.click("Theme settings"); await editField(ui.host, brandInput(), "Updated brand");
    await editField(ui.host, '.pb-panel input[type="email"]', "new@example.com");
    assert.equal(ui.host.querySelector('.pws-eyebrow')?.textContent, "Built for business");
    assert.ok(ui.host.querySelector('.pws-contact [data-element-id="email"]')?.textContent?.includes("Contact sales"));
    await clickElement(ui.host, "links", "page-about-heading"); await editField(ui.host, '[aria-label="Element padding value"]', "4");
    await selectEditor(ui.host, "Select portal page", "website/pages/about");
    await editField(ui.host, '.pb-panel input[maxlength="80"]', "About wholesale");
    await toggleSetting(ui.host, "Visible in website");
    assert.ok(ui.host.querySelector('.pws-text'), "Hidden pages remain editable in the theme preview");
    await selectEditor(ui.host, "Select portal page", "website/home");
    assert.equal(ui.host.querySelector('.pws-links [data-element-id="page-about"]'), null);
    assert.equal(ui.host.querySelector('.pws-header nav')?.textContent?.includes("About wholesale"), false);
    await clickElement(ui.host, "links", "heading"); await editField(ui.host, '[aria-label="Element padding value"]', "4");
    await selectEditor(ui.host, "Select portal page", "website/pages/about"); await toggleSetting(ui.host, "Visible in website");
    await selectEditor(ui.host, "Select portal page", "website/home");
    assert.equal(ui.host.querySelector('.pws-links [data-element-id="page-about-heading"] h3')?.textContent, "About wholesale");
    await ui.click("Save");
    const publicDesign = websiteTools.publicWebsiteDesign(ui.calls[0].design);
    assert.ok(JSON.stringify(publicDesign).includes("About wholesale"));
    assert.ok(JSON.stringify(publicDesign).includes("Built for business"));
    assert.ok(JSON.stringify(publicDesign).includes("Contact sales"));
  } finally { await ui.close(); }
});

test("FAQ nested layout, responsive overrides and numeric fields apply and survive saving", async () => {
  const ui = await mount();
  try {
    await selectEditor(ui.host, "Section type", "faq"); await ui.click("Add section");
    await clickElement(ui.host, "faq", "question-1");
    await selectEditor(ui.host, "Nested element type", "heading"); await ui.click("Add nested element");
    await editField(ui.host, '[aria-label="Font size value"]', "");
    await editField(ui.host, '[aria-label="Font size value"]', "4");
    assert.equal(ui.host.querySelector<HTMLInputElement>('[aria-label="Font size value"]')?.value, "4");
    await editField(ui.host, '[aria-label="Font size value"]', "44");
    const nested = ui.host.querySelector<HTMLElement>('.pws-faq-item .pws-element-children>.pws-element')!;
    assert.equal(nested.style.fontSize, "44px");
    await ui.click("Reset typography"); assert.equal(nested.style.fontSize, "");
    await clickElement(ui.host, "faq", "question-1");
    await editField(ui.host, '[aria-label="Columns value"]', "2");
    await editField(ui.host, '[aria-label="Element mobile columns value"]', "2");
    await editField(ui.host, '[aria-label="Element gap value"]', "12");
    const faq = ui.host.querySelector<HTMLElement>('.pws-faq [data-element-id="question-1"]')!;
    assert.equal(faq.style.getPropertyValue('--pws-block-columns'), "2");
    assert.equal(faq.style.getPropertyValue('--pws-block-mobile-columns'), "2");
    assert.equal(faq.style.getPropertyValue('--pws-element-gap'), "12px");
    assert.ok(faq.querySelector('.pws-faq-item>.pws-element-children') === null);
    assert.ok(faq.querySelector('.pws-faq-item>div>.pws-element-children>.pws-element-heading'));
    await ui.click("Back to section");
    await editField(ui.host, '[aria-label="Mobile section height value"]', "400");
    assert.equal(ui.host.querySelector('.pws-faq')?.getAttribute('data-mobile-height'), "true");
    assert.equal(ui.host.querySelector<HTMLElement>('.pws-faq')?.style.getPropertyValue('--pws-mobile-height'), "400px");
    await ui.click("Save");
    const section = ui.calls[0].design.website!.pages[0].sections.at(-1)!;
    assert.equal(section.style?.mobileHeight, 400);
    assert.equal(section.blocks?.find(block => block.id === "question-1")?.style?.mobileColumns, 2);
  } finally { await ui.close(); }
});

test("slideshow autoplay advances in preview and stops during element editing and when disabled", async () => {
  const timers = new Map<number, () => void>(); let id = 0;
  const originalSet = window.setInterval, originalClear = window.clearInterval;
  window.setInterval = ((callback: () => void, delay: number) => { assert.equal(delay, 5000); timers.set(++id, callback); return id; }) as typeof window.setInterval;
  window.clearInterval = (timer: number) => { timers.delete(timer); };
  const ui = await mount();
  try {
    await selectEditor(ui.host, "Section type", "slideshow"); await ui.click("Add section");
    await toggleSetting(ui.host, "Auto-rotate slides"); assert.equal(timers.size, 1);
    await React.act(async () => { [...timers.values()][0](); });
    const slides = [...ui.host.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]')];
    assert.equal(slides[1].hidden, false);
    await clickElement(ui.host, "slideshow", "slide-2-heading"); assert.equal(timers.size, 0);
    await ui.click("Back to section"); assert.equal(timers.size, 1);
    await toggleSetting(ui.host, "Auto-rotate slides"); assert.equal(timers.size, 0);
  } finally { await ui.close(); window.setInterval = originalSet; window.clearInterval = originalClear; }
});

test("invalid input blocks saving and failed saves preserve editable drafts for retry", async () => {
  const options = { saveError: "Connection interrupted. Try again." };
  const ui = await mount(true, options);
  try {
    await ui.click("Theme settings");
    await editField(ui.host, '[aria-label="Brand color hex code"]', "#nope");
    await ui.click("Save"); assert.equal(ui.calls.length, 0); assert.ok(ui.host.querySelector('[role="alert"]'));
    await editField(ui.host, '[aria-label="Brand color hex code"]', "#123456");
    await ui.click("Save"); assert.equal(ui.calls.length, 1);
    assert.equal(ui.host.querySelector('[role="alert"]')?.textContent, options.saveError);
    assert.equal(ui.button("Save").disabled, false);
    options.saveError = ""; await ui.click("Save"); assert.equal(ui.calls.length, 2);
    assert.equal(ui.calls[1].revision, 0);
    assert.equal(ui.calls[1].design.accent, "#123456");
    assert.ok(ui.host.textContent?.includes("All changes saved"));
  } finally { await ui.close(); }
});
