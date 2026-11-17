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

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/customer-portal" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const native = (tag: string) => function NativeControl({ children, ...props }: Record<string, unknown>) {
  const render = props.render as React.ReactElement | undefined;
  delete props.variant; delete props.size; delete props.nativeButton; delete props.render;
  if (render) return React.cloneElement(render, props, children as React.ReactNode);
  return React.createElement(tag, props, children as React.ReactNode);
};
const controls = {
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
async function mount(canWrite = true) {
  let state: designTools.PortalDesignView = { draft: designTools.defaultPortalDesign(), published: null, revision: 0, updatedAt: null, publishedAt: null };
  const calls: { publish: boolean; design: designTools.PortalDesign; revision: number }[] = [];
  const { PortalBuilder } = load("components/portal-builder.tsx", {
    "next/link": { default: native("a") },
    "@/components/portal-experience": { PortalExperience },
    "@/lib/portal-preview": { portalPreviewData },
    "@/lib/portal-design": designTools,
    "@/lib/portal-themes": themeTools,
    "@/app/customer-portal/actions": { updatePortalDesign: async (input: typeof calls[number]) => {
      calls.push(structuredClone(input));
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

test("builder previews styles and devices and saves a draft separately from publishing", async () => {
  const ui = await mount();
  try {
    const inspector = ui.host.querySelector<HTMLSelectElement>('[aria-label="Editor settings"]')!;
    await React.act(async () => { inspector.value = "theme"; inspector.dispatchEvent(new Event("change", { bubbles: true })); });
    const style = [...ui.host.querySelectorAll<HTMLSelectElement>("select")].find(select => [...select.options].some(option => option.value === "soft"))!;
    await React.act(async () => { style.value = "soft"; style.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(ui.host.querySelector(".portal-app")?.getAttribute("data-theme"), "soft");
    await ui.click("Mobile preview");
    assert.ok(ui.host.querySelector(".pb-device-mobile"));
    await ui.click("Save");
    assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].publish, false); assert.equal(ui.calls[0].design.theme, "soft");
    assert.ok(ui.host.textContent?.includes("Theme saved."));
    await ui.click("Publish");
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
    await ui.click("Add page");
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
  const { PortalThemeArtwork } = load("components/portal-theme-artwork.tsx", {});
  const dialogParts = { Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? React.createElement("div", null, children) : null,
    DialogContent: native("div"), DialogHeader: native("header"), DialogTitle: native("h2"), DialogDescription: native("p") };
  const { PortalThemeLibrary } = load("components/portal-theme-library.tsx", {
    "next/link": { default: native("a") }, "@/components/ui/dialog": dialogParts,
    "@/components/portal-local-time": { PortalLocalTime },
    "@/components/portal-theme-artwork": { PortalThemeArtwork }, "@/components/portal-experience": { PortalExperience },
    "@/lib/portal-design": designTools, "@/lib/portal-themes": themeTools, "@/lib/portal-preview": { portalPreviewData },
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
    },
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(React.createElement(PortalThemeLibrary, { initial: state, canWrite: true, workspaceName: "Test brand" })));
    assert.ok(host.querySelector('[aria-label="Live theme"]'));
    assert.equal(host.querySelectorAll(".ptl-template-card").length, 6);
    assert.equal(host.querySelector(".portal-builder"), null);
    const studio = [...host.querySelectorAll(".ptl-template-card")].find(card => card.textContent?.includes("Studio"))!;
    await React.act(async () => studio.querySelector<HTMLButtonElement>(".ptl-template-info button")!.click());
    assert.deepEqual(adds, ["studio"]);
    assert.ok(host.querySelector('a[href="/customer-portal/themes/saved-studio"]'));
    const row = [...host.querySelectorAll(".ptl-draft-row")].find(item => item.textContent?.includes("Studio"))!;
    const publish = [...row.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Publish")!;
    await React.act(async () => publish.click());
    assert.deepEqual(publishes, ["saved-studio"]);
    assert.ok(host.querySelector(".ptl-live-footer h2")?.textContent?.includes("Studio"));
    await React.act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Preview Bloom template"]')!.click());
    assert.ok(host.querySelector(".ptl-preview-frame .cpa-metrics"));
    const orderLink = [...host.querySelectorAll<HTMLButtonElement>(".ptl-preview-frame .cpa-sidebar button")].find(button => button.textContent === "Orders")!;
    await React.act(async () => orderLink.click());
    assert.ok(host.querySelector(".ptl-preview-frame .cpa-order-steps"));
    assert.equal(host.querySelector(".ptl-preview-frame .cpa-metrics"), null);
  } finally { await React.act(async () => root.unmount()); host.remove(); }
});
