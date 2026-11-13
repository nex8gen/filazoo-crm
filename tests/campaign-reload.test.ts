import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as htmlDocument from "../lib/email-html-document.ts";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import * as sessions from "../lib/campaign-editor-session.ts";
import * as assets from "../lib/marketing-assets.ts";
import * as campaigns from "../lib/email-campaigns.ts";
import * as promotions from "../lib/document-promotions.ts";
import * as designs from "../lib/email-design.ts";
import * as editorState from "../lib/email-editor-state.ts";
import * as messageTools from "../lib/campaign-message-tools.ts";
import * as blockConfig from "../lib/email-block-config.ts";
import * as productTools from "../lib/email-products.ts";
import * as socialTools from "../lib/email-social.ts";
import * as socialAssets from "../lib/email-social-assets.ts";
import * as imageClient from "../lib/email-image-client.ts";
import * as documents from "../lib/documents.ts";

// Exercise actual planner → builder → template library → designer components.
// Native popup/layout primitives are DOM shells; API responses are controlled fixtures.
const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/email/campaigns?year=2026", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const h = React.createElement;
type Props = Record<string, unknown> & { children?: React.ReactNode };
const shell = (tag: string) => ({ children, ...props }: Props) => { delete props.asChild; return h(tag, props, children); };
const button = ({ children, render, ...props }: Props) => { delete props.variant; delete props.size; return React.isValidElement(render) ? React.cloneElement(render as React.ReactElement<Props>, props, children ?? (render as React.ReactElement<Props>).props.children) : h("button", { type: "button", ...props }, children); };
const popup = ({ open, children }: Props) => open ? h("section", {}, children) : null;
const warningToasts = new Map<string, string>();
const errorToasts = new Map<string, React.ReactNode>();
const dependencies: Record<string, unknown> = {
    "@/lib/email-html-document": htmlDocument,
  "@/lib/documents": documents,
  "@/lib/email-block-config": blockConfig, "@/lib/email-products": productTools, "@/lib/email-social": socialTools, "@/lib/email-social-assets": socialAssets, "@/lib/email-image-client": imageClient,
  react: React, "react/jsx-runtime": require("react/jsx-runtime"), "lucide-react": require("lucide-react"), sonner: { toast: { success() {}, message() {}, error(message: React.ReactNode, { id }: { id: string }) { errorToasts.set(id, message); return id; }, warning(message: string, { id }: { id: string }) { warningToasts.set(id, message); return id; }, dismiss(id: string) { warningToasts.delete(id); errorToasts.delete(id); } } },
  "next/dynamic": (loader: () => unknown) => (props: Props) => {
    const name = loader.toString().includes("email-campaign-builder") ? "EmailCampaignBuilder" : "EmailDesignEditor";
    const source = name === "EmailCampaignBuilder" ? "@/components/email-campaign-builder" : "./email-design-editor";
    return h((dependencies[source] as Record<string, React.ComponentType<Props>>)[name], props);
  },
  "@/lib/campaign-editor-session": sessions, "@/lib/marketing-assets": assets, "@/lib/email-campaigns": campaigns, "@/lib/document-promotions": promotions, "@/lib/email-design": designs, "@/lib/email-editor-state": editorState, "@/lib/campaign-message-tools": messageTools,
  "@/components/marketing-asset-editor": { MarketingAssetEditor: () => null },
  "@/components/column-resize-handle": { ColumnResizeHandle: () => null },
  "@/components/campaign-audience-select": { CampaignAudienceSelect: () => h("div", {}, "Audience picker") },
  "@/components/campaign-subject-fields": { CampaignSubjectFields: ({ config, onChange }: { config: campaigns.CampaignConfig; onChange: (value: Partial<campaigns.CampaignConfig>) => void }) => h("input", { "aria-label": "Subject line", value: config.subject, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ subject: event.target.value }) }) },
  "@/components/use-document-library": { useDocumentLibrary: () => ({ data: { documents: [], total: 0 }, loading: false, error: "", invalidate() {} }) },
  "@/components/ui/button": { Button: button }, "@/components/ui/input": { Input: shell("input") }, "@/components/ui/textarea": { Textarea: shell("textarea") },
  "@/components/ui/table-filters": { TableFilters: shell("div"), TableFilter: ({ children }: Props) => h("div", {}, children) },
  "@/components/ui/select": { Select: ({ children }: Props) => h("div", {}, children), SelectContent: shell("div"), SelectItem: ({ children }: Props) => h("span", {}, children), SelectTrigger: button, SelectValue: () => null },
  "@/components/ui/dropdown-menu": { DropdownMenu: shell("div"), DropdownMenuTrigger: button, DropdownMenuContent: shell("div"), DropdownMenuItem: button, DropdownMenuSeparator: shell("hr") },
  "@/components/ui/dialog": { Dialog: popup, DialogContent: shell("div"), DialogHeader: shell("header"), DialogTitle: shell("h2"), DialogDescription: shell("p"), DialogFooter: shell("footer") },
  "@/components/ui/sheet": { Sheet: popup, SheetContent: shell("div"), SheetHeader: shell("header"), SheetTitle: shell("h2"), SheetDescription: shell("p") },
};
function load(file: string, key: string) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports: Record<string, React.ComponentType<Props>> = {};
  vm.runInNewContext(compiled, { exports, require: (name: string) => name.endsWith(".css") ? {} : dependencies[name] ?? (() => { throw Error(`Missing dependency ${name}`); })(), window, document, navigator, HTMLElement, HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement, Event, AbortController, setTimeout, clearTimeout, crypto, Intl, URL, URLSearchParams, console, fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }, { filename: file });
  dependencies[key] = exports;
  return exports;
}
load("ui/notification-toast.tsx", "@/components/ui/notification-toast");
load("use-campaign-location.ts", "@/components/use-campaign-location");
for (const name of ["email-editor-controls", "email-block-controls", "email-image-maker", "email-split-editor", "email-block-style-editor", "email-product-editor", "email-social-editor"]) load(`${name}.tsx`, `@/components/${name}`);
load("email-design-editor.tsx", "./email-design-editor");
load("campaign-template-library.tsx", "@/components/campaign-template-library");
load("email-campaign-builder.tsx", "@/components/email-campaign-builder");
const { DocumentPromotions } = load("document-promotions.tsx", "@/components/document-promotions");

const savedAsset = { ...assets.newMarketingAsset("factory_sale", 2026), title: "Reload campaign", updatedAt: "2026-11-13T02:00:00Z", message: "Original body", campaignConfig: campaigns.campaignConfigSchema.parse({ subject: "Original subject", includeSegments: ["all"] }) };
async function mount(serverAssets: assets.MarketingAsset[] = [savedAsset], reset = true, campaignOptions: campaigns.CampaignOptions = { mailboxes: [], audiences: [], sendingEnabled: false }, saveError = "") {
  if (reset) { window.sessionStorage.clear(); window.history.replaceState(null, "", "/email/campaigns?year=2026"); }
  const writes: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") writes.push(url);
    if (url === "/api/marketing-assets" && init?.method === "POST" && saveError) return { ok: false, json: async () => ({ error: saveError }) };
    const value = url.startsWith("/api/marketing-assets") ? { assets: serverAssets } : init?.method === "POST" ? { count: 1, excluded: 0, recent: 0, recipients: [] } : campaignOptions;
    return { ok: true, json: async () => structuredClone(value) };
  };
  // The VM globals resolve fetch at invocation time through this proxy.
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetcher });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await React.act(async () => { root.render(h(DocumentPromotions, { year: 2026, sessionScope: "workspace:user", canWrite: true, onCreateTemplate() {} })); });
  function find(name: string) {
    const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => (item.getAttribute("aria-label") || item.textContent)?.replace(/\s+/g, "") === name.replace(/\s+/g, ""));
    assert.ok(node, `Button ${name} not found`); return node;
  }
  async function click(name: string) { await React.act(async () => find(name).click()); }
  async function set(selector: string, value: string) {
    const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector); assert.ok(node, selector);
    await React.act(() => { Object.getOwnPropertyDescriptor(node.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  return { host, click, find, set, writes, async open() { await React.act(() => { const card = host.querySelector<HTMLButtonElement>(".campaign-card"); assert.ok(card); card.click(); }); await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); }); await click("Next"); }, async dispose() { await React.act(() => root.unmount()); host.remove(); } };
}

test("link warnings use the shared toast while Next opens review and sending stays available", async () => {
  const emailDesign = designs.newEmailDesign("Special offers");
  emailDesign.blocks.push(designs.newEmailBlock("button", { text: "Shop now", href: "" }), designs.newEmailBlock("video", { href: "invalid" }));
  const asset = { ...savedAsset, campaignConfig: campaigns.campaignConfigSchema.parse({ ...savedAsset.campaignConfig, mailboxId: "sender", emailDesign }) };
  const ui = await mount([asset], true, { mailboxes: [{ id: "sender", name: "Sender", email: "sender@example.test", available: true }], audiences: [], sendingEnabled: true });
  try {
    await ui.open();
    assert.match(warningToasts.get(`campaign-message-warning-${asset.id}`) ?? "", /You can continue/);
    assert.equal(warningToasts.size, 1);
    assert.equal(ui.host.querySelector(".campaign-builder-warning"), null);
    assert.equal(ui.host.querySelector('[role="alert"]'), null);
    await ui.click("Next");
    assert.equal(ui.host.querySelector('[aria-current="step"]')?.textContent, "3Review");
    assert.equal(warningToasts.size, 1);
    assert.equal(ui.find("Send campaign").disabled, false);
  } finally { await ui.dispose(); }
  assert.equal(warningToasts.size, 0);
});

test("campaign save conflicts use a single toast and keep the unsaved draft", async () => {
  const conflict = "This plan changed in another session. Reload the page before saving.";
  const ui = await mount([savedAsset], true, { mailboxes: [], audiences: [], sendingEnabled: false }, conflict);
  try {
    await ui.open();
    await ui.set('input[aria-label="Subject line"]', "Keep this unsaved subject");
    await ui.click("Save draft");
    assert.equal(errorToasts.size, 1);
    const markup = renderToStaticMarkup([...errorToasts.values()][0]);
    assert.match(markup, /This plan changed in another session/);
    assert.equal(ui.host.querySelector(".campaign-builder-banner"), null);
    assert.equal(ui.host.querySelector('[role="alert"]'), null);
    assert.doesNotMatch(ui.host.textContent ?? "", /This plan changed in another session/);
    assert.equal(ui.host.querySelector<HTMLInputElement>('input[aria-label="Subject line"]')?.value, "Keep this unsaved subject");
    assert.equal(ui.find("Save draft").disabled, false);
  } finally { await ui.dispose(); }
  assert.equal(errorToasts.size, 0);
});

test("reloading an existing campaign keeps its step, message view and unsaved fields", async () => {
  let ui = await mount();
  try {
    await ui.open(); await ui.click("2 Message"); await ui.click("Choose template"); await ui.click("Write message");
    await ui.set('input[aria-label="Subject line"]', "Subject before reload");
    await ui.set("#campaign-message-body", "Body before reload");
    assert.equal(new URLSearchParams(window.location.search).get("campaign"), savedAsset.id);
    assert.equal(new URLSearchParams(window.location.search).get("step"), "message");
    await ui.dispose(); ui = await mount([savedAsset], false);
    assert.equal(ui.host.querySelector<HTMLInputElement>('input[aria-label="Subject line"]')?.value, "Subject before reload");
    assert.equal(ui.host.querySelector<HTMLTextAreaElement>("#campaign-message-body")?.value, "Body before reload");
    assert.equal(ui.host.querySelector('[aria-current="step"]')?.textContent, "2Message");
    assert.ok(!ui.writes.includes("/api/marketing-assets"));
  } finally { await ui.dispose(); }
});

test("a new campaign survives reload before its first server save", async () => {
  let ui = await mount([]);
  try {
    await ui.click("New campaign");
    const id = new URLSearchParams(window.location.search).get("campaign"); assert.ok(id);
    await ui.set(".campaign-builder-setupFields input[required]", "Draft before first save");
    await ui.dispose(); ui = await mount([], false);
    assert.equal(new URLSearchParams(window.location.search).get("campaign"), id);
    assert.equal(ui.host.querySelector<HTMLInputElement>(".campaign-builder-setupFields input[required]")?.value, "Draft before first save");
    assert.equal(ui.writes.length, 0);
  } finally { await ui.dispose(); }
});

test("reloading inside the designer restores its content and Done keeps it in the campaign", async () => {
  let ui = await mount();
  try {
    await ui.open(); await ui.click("2 Message"); await ui.click("Edit email");
    const text = ui.host.querySelector<HTMLElement>("[contenteditable]"); assert.ok(text);
    await React.act(() => { text.textContent = "Designer text before reload"; text.dispatchEvent(new Event("input", { bubbles: true })); });
    await ui.set('input[aria-label="Template name"]', "Recovered design title");
    await ui.dispose(); ui = await mount([savedAsset], false);
    assert.ok(ui.host.querySelector(".email-designer"));
    assert.equal(ui.host.querySelector("[contenteditable]")?.textContent, "Designer text before reload");
    assert.equal(ui.host.querySelector<HTMLInputElement>('input[aria-label="Template name"]')?.value, "Recovered design title");
    await ui.click("Done"); assert.equal(ui.host.querySelector(".email-designer"), null);
    await ui.dispose(); ui = await mount([savedAsset], false);
    assert.equal(ui.host.querySelector(".email-designer"), null);
    assert.match(ui.host.querySelector<HTMLIFrameElement>('iframe[title="Campaign email preview"]')?.srcdoc ?? "", /Designer text before reload/);
  } finally { await ui.dispose(); }
});

test("a newer server revision replaces stale recovered edits", async () => {
  let ui = await mount();
  try {
    await ui.open(); await ui.click("2 Message");
    await ui.set('input[aria-label="Subject line"]', "Old local edit");
    await ui.click("Edit email");
    await ui.dispose();
    ui = await mount([{ ...savedAsset, updatedAt: "2026-11-13T03:00:00Z", campaignConfig: { ...savedAsset.campaignConfig, subject: "New server edit" } }], false);
    assert.equal(ui.host.querySelector<HTMLInputElement>('input[aria-label="Subject line"]')?.value, "New server edit");
    assert.equal(ui.host.querySelector(".email-designer"), null);
  } finally { await ui.dispose(); }
});

test("saved campaign URLs reopen the same step even without local storage", async () => {
  let ui = await mount();
  try {
    await ui.open(); window.sessionStorage.clear();
    await ui.dispose(); ui = await mount([savedAsset], false);
    assert.equal(ui.host.querySelector('[aria-current="step"]')?.textContent, "2Message");
    assert.equal(ui.host.querySelector<HTMLInputElement>('input[aria-label="Subject line"]')?.value, "Original subject");
  } finally { await ui.dispose(); }
});

test("explicit discard clears recovery and returns to the campaign list", async () => {
  let ui = await mount();
  try {
    await ui.open(); await ui.set('input[aria-label="Subject line"]', "Discard this subject");
    await ui.click("Back to campaigns"); await ui.click("Discard changes");
    assert.equal(new URLSearchParams(window.location.search).get("campaign"), null);
    assert.equal(window.sessionStorage.getItem(sessions.campaignSessionKey("workspace:user", savedAsset.id)), null);
    await ui.dispose(); ui = await mount([savedAsset], false);
    assert.equal(ui.host.querySelector(".campaign-builder"), null);
    await ui.open();
    assert.equal(ui.host.querySelector<HTMLInputElement>('input[aria-label="Subject line"]')?.value, "Original subject");
  } finally { await ui.dispose(); }
});

test("deleted saved campaigns are not resurrected from session storage", async () => {
  let ui = await mount();
  try {
    await ui.open(); await ui.dispose(); ui = await mount([], false);
    assert.match(ui.host.textContent ?? "", /Campaign not found/);
    assert.equal(ui.host.querySelector(".campaign-builder"), null);
    await ui.click("Back to campaigns");
    assert.equal(new URLSearchParams(window.location.search).get("campaign"), null);
  } finally { await ui.dispose(); }
});

test("browser Back and Forward leave and reopen the selected campaign", async () => {
  const ui = await mount();
  try {
    await ui.open();
    const editorUrl = window.location.href;
    await React.act(() => { window.history.replaceState(null, "", "/email/campaigns?year=2026"); window.dispatchEvent(new dom.window.PopStateEvent("popstate")); });
    assert.equal(ui.host.querySelector(".campaign-builder"), null);
    await React.act(() => { window.history.replaceState(null, "", editorUrl); window.dispatchEvent(new dom.window.PopStateEvent("popstate")); });
    assert.equal(ui.host.querySelector('[aria-current="step"]')?.textContent, "2Message");
  } finally { await ui.dispose(); }
});

test("blocked browser storage still permits creating and editing a new campaign", async () => {
  const ui = await mount([]);
  const descriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
  Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw Error("blocked"); } });
  try {
    await ui.click("New campaign");
    await ui.set(".campaign-builder-setupFields input[required]", "Editable without storage");
    assert.equal(ui.host.querySelector<HTMLInputElement>(".campaign-builder-setupFields input[required]")?.value, "Editable without storage");
    assert.doesNotMatch(ui.host.textContent ?? "", /Campaign not found/);
  } finally { Object.defineProperty(window, "sessionStorage", descriptor); await ui.dispose(); }
});
