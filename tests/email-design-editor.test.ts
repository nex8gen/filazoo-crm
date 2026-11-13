import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { JSDOM } from "jsdom";
import * as designTools from "../lib/email-design.ts";
import * as editorState from "../lib/email-editor-state.ts";
import * as socialTools from "../lib/email-social.ts";
import * as socialAssets from "../lib/email-social-assets.ts";
import * as blockConfig from "../lib/email-block-config.ts";
import * as productTools from "../lib/email-products.ts";
import * as imageClient from "../lib/email-image-client.ts";
import * as htmlDocument from "../lib/email-html-document.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

// Component integration tests: real React events/history and design renderer;
// shared popup primitives are replaced with DOM shells so native layout is not required.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://crm.test", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const h = React.createElement;
const act = React.act;
const resizeApi: { ColumnResizeHandle?: React.ComponentType<Record<string, unknown>> } = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/column-resize-handle.tsx", import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: resizeApi, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : require(name), window: dom.window, localStorage: dom.window.localStorage });
type Design = designTools.EmailDesign;
type Props = Record<string, unknown> & { children?: React.ReactNode };
const shell = (tag: string) => ({ children, ...props }: Props) => h(tag, props, children);
const button = (all: Props) => { const { children, render, ...props } = all; delete props.variant; delete props.size; return React.isValidElement(render) ? React.cloneElement(render as React.ReactElement<Props>, props, children ?? (render as React.ReactElement<Props>).props.children) : h("button", { type: "button", ...props }, children); };

async function mount(initial = { ...designTools.newEmailDesign(), blocks: [] } as Design, deferredUpload = false, saveFailure = "") {
  const host = document.createElement("div"); document.body.append(host);
  const applied: Design[] = [], saved: Array<{ design: Design; name: string; existing: unknown }> = [], downloads: { blob: Blob; filename?: string }[] = [];
  let closed = 0, pendingReader: { result: string; onload?: () => void } | undefined;
  class DeferredReader { result = ""; onload?: () => void; onerror?: () => void; onabort?: () => void; readAsDataURL() { pendingReader = { result: "", onload: () => { this.result = pendingReader!.result; this.onload?.(); } }; } }
  const editorDocument = new Proxy(document, { get: (target, key) => key === "createElement" ? (tag: string) => { const node = target.createElement(tag); if (tag === "a") (node as HTMLAnchorElement).click = () => { downloads.at(-1)!.filename = (node as HTMLAnchorElement).download; }; return node; } : typeof Reflect.get(target, key, target) === "function" ? Reflect.get(target, key, target).bind(target) : Reflect.get(target, key, target) });
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": require("lucide-react"),
    "@/lib/email-design": designTools,
    "@/lib/email-editor-state": editorState,
    "@/lib/email-social": socialTools,
    "@/lib/email-social-assets": socialAssets,
    "@/lib/email-block-config": blockConfig,
    "@/lib/email-products": productTools,
    "@/lib/email-image-client": imageClient,
    "@/lib/email-html-document": htmlDocument,
    "@/components/column-resize-handle": resizeApi,
    "@/components/ui/button": { Button: button },
    "@/components/ui/input": { Input: shell("input") },
    "@/components/ui/textarea": { Textarea: shell("textarea") },
    "@/components/ui/dropdown-menu": { DropdownMenu: shell("div"), DropdownMenuTrigger: button, DropdownMenuContent: shell("div"), DropdownMenuItem: button, DropdownMenuSeparator: shell("hr") },
    "@/components/ui/dialog": { Dialog: ({ open, children }: Props) => open ? children : null, DialogContent: shell("section"), DialogHeader: shell("header"), DialogTitle: shell("h2"), DialogDescription: shell("p"), DialogFooter: shell("footer") },
    "./email-design-editor.css": {},
    "./email-editor-controls.css": {},
    "./email-social-editor.css": {},
    "./email-block-controls.css": {},
    "./email-product-editor.css": {},
  };
  // Keep Base UI popups as native selects here; use the real composed inspector controls.
  function optionText(nodes: React.ReactNode): string { return React.Children.toArray(nodes).map(node => typeof node === "string" || typeof node === "number" ? String(node) : React.isValidElement<Props>(node) ? optionText(node.props.children) : "").join(""); }
  const selectItem = ({ value, children }: Props) => h("option", { value }, optionText(children));
  dependencies["@/components/ui/select"] = {
    Select: ({ value, onValueChange, children }: Props) => {
      const options: React.ReactNode[] = [];
      let label: unknown;
      function visit(nodes: React.ReactNode) {
        React.Children.forEach(nodes, node => {
          if (!React.isValidElement<Props>(node)) return;
          if (node.props["aria-label"]) label = node.props["aria-label"];
          if (node.type === selectItem) options.push(node);
          else visit(node.props.children);
        });
      }
      visit(children);
      return h("select", { value, "aria-label": label, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => (onValueChange as (value: string) => void)(event.target.value) }, options);
    },
    SelectTrigger: shell("span"), SelectValue: () => null, SelectContent: shell("span"), SelectItem: selectItem,
  };
  const controlsApi = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/email-editor-controls.tsx", import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: controlsApi, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => { assert.ok(name in dependencies, `Unexpected control dependency ${name}`); return dependencies[name]; })(name) });
  dependencies["@/components/email-editor-controls"] = controlsApi;
  for (const name of ["email-block-controls", "email-image-maker", "email-split-editor", "email-block-style-editor", "email-product-editor"]) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, document: editorDocument, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((key: string) => { assert.ok(key in dependencies, `Unexpected ${name} dependency ${key}`); return dependencies[key]; })(name) });
    dependencies[`@/components/${name}`] = exports;
  }
  const socialApi = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/email-social-editor.tsx", import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: socialApi, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => { assert.ok(name in dependencies, `Unexpected social dependency ${name}`); return dependencies[name]; })(name) });
  dependencies["@/components/email-social-editor"] = socialApi;
  const api: { EmailDesignEditor?: React.ComponentType<Props> } = {};
  const source = ts.transpileModule(readFileSync(new URL("../components/email-design-editor.tsx", import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports: api, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; })(name), Error, window: dom.window, document: editorDocument, HTMLInputElement, HTMLTextAreaElement, FileReader: deferredUpload ? DeferredReader : dom.window.FileReader, Blob: dom.window.Blob, URL: { createObjectURL: (blob: Blob) => { downloads.push({ blob }); return "blob:verification"; }, revokeObjectURL: () => {} }, setTimeout: () => 0 });
  const root = createRoot(host);
  await act(() => root.render(h(api.EmailDesignEditor!, { initial, name: "Audit email", subject: "Audit subject", products: [{ sku: "PLA", name: "PLA filament", material: "PLA", imageUrl: "https://example.test/product.png", price: "$20", status: "Active", stockStatus: "In stock" }, { sku: "ABS", name: "ABS filament", material: "ABS", imageUrl: "https://example.test/abs.png", price: "$25", status: "Active", stockStatus: "In stock" }], onApply: (value: Design) => applied.push(structuredClone(value)), onClose: () => closed++, onSave: async (value: Design, name: string, existing: unknown) => { saved.push({ design: structuredClone(value), name, existing }); if (saveFailure) throw new Error(saveFailure); return { id: "saved-template", name }; } })));
  const normalize = (value: string | null) => value?.replace(/\s+/g, " ").trim();
  function findButton(name: string) { const node = [...host.querySelectorAll<HTMLButtonElement>("button")].findLast(item => (normalize(item.getAttribute("aria-label") || item.textContent)?.replace(/\s/g, "") === name.replace(/\s/g, ""))); assert.ok(node, `Button not found: ${name}`); return node; }
  function field(name: string, scope: ParentNode = host) {
    const direct = [...scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")].find(item => item.getAttribute("aria-label") === name);
    if (direct) return direct;
    const label = [...scope.querySelectorAll("label")].find(item => (normalize(item.firstChild?.textContent ?? "") === name || normalize(item.textContent) === name));
    const input = label?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select"); assert.ok(input, `Field not found: ${name}`); return input;
  }
  async function click(name: string) {
    const node = findButton(name);
    await act(() => { if (document.activeElement instanceof HTMLElement && document.activeElement !== node) document.activeElement.blur(); node.click(); });
  }
  async function set(name: string, value: string, blur = false, scope: ParentNode = host) {
    const node = field(name, scope);
    await act(() => {
      node.focus();
      const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
      node.dispatchEvent(new dom.window.Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      if (blur) node.blur();
    });
  }
  async function snapshot() { await click("Done"); return applied.at(-1)!; }
  async function drag(data: unknown, parent = "root", column = 0, before = "end") {
    const target = [...host.querySelectorAll<HTMLElement>("[data-drop-parent]")].find(node => node.dataset.dropParent === parent && node.dataset.dropColumn === String(column) && node.dataset.dropBefore === before); assert.ok(target, `Drop target ${parent}:${column}:${before}`);
    await act(() => { const event = new dom.window.Event("dragover", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "move", dropEffect: "" } }); target.dispatchEvent(event); });
    assert.equal(target.dataset.dragOver, "true");
    await act(() => { const event = new dom.window.Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { getData: () => JSON.stringify(data), effectAllowed: "move" } }); target.dispatchEvent(event); });
  }
  async function dragStart(name: string) {
    const source = findButton(name); assert.equal(source.draggable, true, name);
    const values = new Map<string, string>();
    await act(() => { const event = new dom.window.Event("dragstart", { bubbles: true }); Object.defineProperty(event, "dataTransfer", { value: { setData: (type: string, value: string) => values.set(type, value), effectAllowed: "" } }); source.dispatchEvent(event); });
    return JSON.parse(values.get("application/x-filazoo-email-block")!);
  }
  return { host, click, set, field, findButton, dragStart, snapshot, applied, saved, downloads, drag, closed: () => closed,
    async upload(type = "image/png", size = 4) { const input = host.querySelector<HTMLInputElement>("input[type=file]"); assert.ok(input); const file = new dom.window.File([new Uint8Array(size)], "example.png", { type }); await act(() => { Object.defineProperty(input, "files", { configurable: true, value: [file] }); input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); },
    async finishUpload() { assert.ok(pendingReader); await act(() => { pendingReader!.result = "data:image/png;base64,AAAA"; pendingReader!.onload?.(); }); },
    async dispose() { await act(() => root.unmount()); host.remove(); },
  };
}

const palette: Array<[string, designTools.EmailBlockType]> = [["Text", "text"], ["Image", "image"], ["Split", "columns"], ["Button", "button"], ["Header bar", "header"], ["Drop shadow", "section"], ["Divider", "divider"], ["Social links", "social"], ["Spacer", "spacer"], ["Product", "product"], ["Coupon", "coupon"], ["Table", "table"], ["Review quote", "quote"], ["Video", "video"], ["HTML", "html"], ["Columns", "columns"], ["Section", "section"]];

function section(host: ParentNode, title: string) {
  const node = [...host.querySelectorAll("details.email-block-section,section.email-block-section")].find(node => node.querySelector(":scope>summary,:scope>h3")?.textContent === title);
  assert.ok(node, `Section ${title}`); return node;
}

async function toggleSection(host: ParentNode, title: string, open: boolean) {
  const node = section(host, title) as HTMLDetailsElement;
  assert.equal(node.tagName, "DETAILS", `${title} must be collapsible`);
  await act(() => { node.open = open; node.dispatchEvent(new dom.window.Event("toggle")); });
  return node;
}

test("block sections retain the user's disclosure state while editing settings", async () => {
  const ui = await mount();
  try {
    await ui.click("Text");
    assert.equal(ui.host.querySelectorAll("section.email-block-section").length, 0);
    const text = await toggleSection(ui.host, "Text", false);
    await ui.set("Text area padding vertical", "12");
    assert.equal(text.open, false);
    const background = await toggleSection(ui.host, "Text area background color", true);
    await ui.set("Content background color hex value", "#112233");
    await ui.set("Content background color hex value", "transparent", true);
    assert.equal(background.open, true, "clearing a background must leave its controls open");
    await toggleSection(ui.host, "Text", true);
    assert.equal(ui.field("Text").value, "Add your text here.");
  } finally { await ui.dispose(); }
});

test("letter spacing supports decimal and negative values without replacing the typing draft", async () => {
  const ui = await mount();
  try {
    await ui.click("Text");
    await ui.set("Letter spacing", "1.0");
    assert.equal(ui.field("Letter spacing").value, "1.0");
    await ui.set("Letter spacing", "-0.5", true);
    const result = await ui.snapshot();
    assert.equal(result.blocks[0].presentation.letterSpacing, -0.5);
    assert.match(designTools.renderEmailDesign(result).html, /letter-spacing:-0.5px/);
    await ui.click("Increase letter spacing");
    assert.equal(ui.field("Letter spacing").value, "-0.4");
  } finally { await ui.dispose(); }
});

test("photo sections and text line spacing stay editable across canvas, undo and export", async () => {
  const ui = await mount();
  try {
    await ui.click("Section");
    await ui.set("Background image URL", "/email-template-assets/colorlib/8/images/bg_1.jpg");
    await ui.set("Minimum height", "320", true);
    const canvas = ui.host.querySelector<HTMLElement>(".email-designer-blockContent")!;
    assert.match(canvas.style.backgroundImage, /colorlib\/8\/images\/bg_1.jpg/);
    assert.equal(canvas.style.minHeight, "320px");
    const hero = (await ui.snapshot()).blocks[0];
    await ui.drag({ type: "text" }, hero.id);
    await ui.set("Text", "An editable photo heading");
    await ui.set("Line height", "1.2", true);
    const updated = await ui.snapshot();
    const text = updated.blocks.find(block => block.type === "text")!;
    assert.equal(text.parentId, hero.id);
    assert.equal(text.presentation.lineHeight, 1.2);
    await ui.click("Undo");
    assert.equal((await ui.snapshot()).blocks.find(block => block.id === text.id)!.presentation.lineHeight, undefined);
    await ui.click("Redo");
    const saved = designTools.emailDesignSchema.parse(JSON.parse(JSON.stringify(await ui.snapshot())));
    const exported = designTools.renderEmailDesign(saved).html;
    assert.match(exported, /background="https:\/\/raw\.githubusercontent\.com\/ColorlibHQ\/email-templates\//);
    assert.match(exported, /height="320"/);
    assert.match(exported, /line-height:1.2/);
    assert.match(exported, /An editable photo heading/);
    const unsafe = structuredClone(saved);
    unsafe.blocks[0].presentation.backgroundImage = "javascript:alert(1)";
    assert.doesNotMatch(designTools.renderEmailDesign(unsafe).html, /javascript:|alert\(1\)/);
  } finally { await ui.dispose(); }
});

test("paired padding controls agree with all four exported sides and undo reveals unequal sides", async () => {
  const ui = await mount();
  try {
    await ui.click("Text"); await ui.click("Edit block padding individual sides");
    await ui.set("Block padding top", "10"); await ui.set("Block padding bottom", "20");
    await ui.click("Edit block padding individual sides");
    assert.equal(ui.field("Block padding vertical").value, "10");
    assert.equal(blockConfig.blockInsets((await ui.snapshot()).blocks[0]).bottom, 10);
    await ui.click("Undo");
    assert.equal(ui.field("Block padding bottom").value, "20");
  } finally { await ui.dispose(); }
});

test("template style groups and social style groups use the same collapsible controls", async () => {
  const ui = await mount();
  try {
    await ui.click("Edit styles");
    const layout = await toggleSection(ui.host, "Layout", false);
    await ui.set("Template background hex value", "#abcdef");
    assert.equal(layout.open, false);
    await toggleSection(ui.host, "Text and headings", false);
    await ui.click("Add content"); await ui.click("Social links");
    for (const title of ["Content", "Icon styles", "Block background color", "Block padding"]) {
      await toggleSection(ui.host, title, false);
      await toggleSection(ui.host, title, true);
    }
  } finally { await ui.dispose(); }
});

test("reference text controls independently edit content area, four-sided outer padding, and device visibility", async () => {
  const ui = await mount();
  try {
    await ui.click("Text"); await ui.set("Text", "Four-sided text"); await ui.click("strikethrough");
    await ui.set("Text area padding vertical", "8"); await ui.set("Content background color hex value", "#112233");
    await ui.set("Border style", "dotted"); await ui.set("Border width", "3");
    await ui.click("Edit block padding individual sides"); await ui.set("Block padding top", "9"); await ui.set("Block padding right", "18"); await ui.set("Block padding bottom", "12"); await ui.set("Block padding left", "24");
    await ui.click("Display"); await act(() => ui.field("Show on desktop").click());
    const result = await ui.snapshot(), p = result.blocks[0].presentation;
    assert.deepEqual(p.padding, { top: 9, right: 18, bottom: 12, left: 24 });
    assert.equal(p.areaBackground, "#112233"); assert.equal(p.border!.style, "dotted"); assert.equal(p.strike, true); assert.equal(p.showDesktop, false);
    assert.match(designTools.renderEmailDesign(result).html, /border:3px dotted/);
  } finally { await ui.dispose(); }
});

test("reference image layout controls enable fixed height and separate mobile column fill", async () => {
  const ui = await mount();
  try {
    await ui.click("Image"); await ui.set("Image URL", "https://example.test/layout.png");
    await ui.set("Image width", "360"); assert.equal(ui.field("Image height").disabled, true);
    await act(() => ui.field("Lock aspect ratio").click()); await ui.set("Image height", "180");
    await act(() => ui.field("Fill column on mobile").click());
    await ui.set("Image area padding horizontal", "12"); await ui.set("Image area border style", "solid"); await ui.set("Image area border width", "2");
    const result = await ui.snapshot();
    assert.equal(result.blocks[0].presentation.image!.height, 180); assert.equal(result.blocks[0].presentation.image!.fillMobile, true);
    assert.match(designTools.renderEmailDesign(result).html, /width:360px.*height:180px/);
    assert.match(designTools.renderEmailDesign(result, { viewport: "mobile" }).html, /width:100%/);
    await ui.set("Image URL", "/api/product-images/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png");
    await ui.click("Preview"); const frame = ui.host.querySelector<HTMLIFrameElement>('iframe[title="Designed email preview"]')!;
    assert.equal(frame.getAttribute("sandbox"), "allow-same-origin"); assert.match(frame.srcdoc, /src="\/api\/product-images/);
  } finally { await ui.dispose(); }
});

test("split Content tab edits each column, changes its content type, and retains layout settings through undo", async () => {
  const ui = await mount();
  try {
    await ui.click("Split"); await ui.click("Column content Image"); await ui.set("Column image URL", "https://example.test/left.png"); await ui.set("Column image alt text", "Left photo");
    await ui.click("Edit column 2"); await ui.click("Column content HTML"); await ui.set("Column HTML", "<strong>Right HTML</strong>");
    await ui.click("Styles"); await ui.set("Column 1 width", "35"); await ui.set("Column gap", "36"); await ui.click("Right to left");
    const result = await ui.snapshot(), split = result.blocks[0];
    assert.deepEqual(split.presentation.columns!.widths, [35, 65]); assert.equal(split.presentation.columns!.gap, 36);
    assert.equal(result.blocks[1].alt, "Left photo"); assert.equal(result.blocks[2].html, "<strong>Right HTML</strong>");
    const html = designTools.renderEmailDesign(result, { viewport: "mobile" }).html;
    assert.ok(html.indexOf("Right HTML") < html.indexOf('alt="Left photo"'));
    await ui.click("Undo"); assert.equal(ui.findButton("Left to right").getAttribute("aria-pressed"), "true");
  } finally { await ui.dispose(); }
});

test("static product browser searches catalog, saves selection and edits independent name, price and button styles", async () => {
  const ui = await mount();
  try {
    await ui.click("Product"); await ui.click("Add products"); await ui.set("Search products", "PLA");
    assert.equal(ui.host.querySelector('[aria-label="Select product ABS"]'), null);
    await act(() => ui.field("Select product PLA").click()); await ui.click("Use selected products");
    await ui.set("Product 1 href", "https://shop.test/pla"); await ui.set("Product 1 originalPrice", "$30");
    await act(() => ui.field("Original price for sale products").click());
    await ui.set("Font size", "22", false, section(ui.host, "Text"));
    await ui.set("Font size", "14", false, section(ui.host, "Button text"));
    await ui.set("Product button text", "Buy PLA"); await ui.set("Products per row", "1");
    await ui.click("Save as template");
    const result = ui.saved.at(-1)!.design, product = result.blocks[0].product!;
    assert.equal(product.cards[0].sku, "PLA"); assert.equal(product.cards[0].price, "$20"); assert.equal(product.nameStyle!.fontSize, 22); assert.equal(product.button!.fontSize, 14);
    assert.deepEqual(productTools.emailProductIssues(result), []);
    const html = designTools.renderEmailDesign(result).html;
    assert.match(html, />Buy PLA<\/a>/); assert.match(html, /<s>\$30<\/s>/); assert.match(html, /font-size:22px/);
  } finally { await ui.dispose(); }
});

test("dynamic product feeds save real material filters, product URL templates and catalog snapshots", async () => {
  const ui = await mount();
  try {
    await ui.click("Product");
    const dynamic = [...ui.host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.startsWith("Dynamic"))!;
    await act(() => dynamic.click());
    await act(() => ui.host.querySelector<HTMLButtonElement>(".email-product-feedCard")!.click());
    await ui.set("Feed name", "PLA range"); await ui.set("Feed material", "PLA"); await ui.set("Product link template", "https://shop.test/products/{sku}");
    await ui.click("Use this feed");
    const result = await ui.snapshot(), p = result.blocks[0].product!;
    assert.equal(p.mode, "dynamic"); assert.equal(p.feed!.material, "PLA"); assert.equal(p.cards.length, 1);
    assert.equal(p.cards[0].href, "https://shop.test/products/PLA"); assert.deepEqual(productTools.emailProductIssues(result), []);
  } finally { await ui.dispose(); }
});

test("product picker filters and selected tab work, with keyboard and drag reordering preserving product URLs", async () => {
  const ui = await mount();
  try {
    await ui.click("Product"); await ui.click("Add products"); await ui.set("Catalog material", "PLA");
    assert.equal(ui.host.querySelector('[aria-label="Select product ABS"]'), null);
    await act(() => ui.field("Select product PLA").click()); await ui.set("Catalog material", "");
    await ui.click("Selected products"); assert.equal(ui.host.querySelector('[aria-label="Select product ABS"]'), null);
    assert.equal(ui.host.querySelectorAll(".email-product-thumbnail").length, 1);
    await ui.click("All products"); await act(() => ui.field("Select product ABS").click()); await ui.click("Use selected products");
    await ui.set("Product 1 href", "https://shop.test/pla"); await ui.set("Product 2 href", "https://shop.test/abs");
    await act(() => ui.findButton("Reorder product 2").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    assert.equal((await ui.snapshot()).blocks[0].product!.cards[0].sku, "ABS");
    const values = new Map<string, string>();
    await act(() => { const event = new dom.window.Event("dragstart", { bubbles: true }); Object.defineProperty(event, "dataTransfer", { value: { setData: (type: string, value: string) => values.set(type, value), effectAllowed: "" } }); ui.findButton("Reorder product 1").dispatchEvent(event); });
    await act(() => { const event = new dom.window.Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { getData: (type: string) => values.get(type) } }); ui.host.querySelector('[data-product-index="1"]')!.dispatchEvent(event); });
    const cards = (await ui.snapshot()).blocks[0].product!.cards;
    assert.deepEqual(cards.map(card => [card.sku, card.href]), [["PLA", "https://shop.test/pla"], ["ABS", "https://shop.test/abs"]]);
  } finally { await ui.dispose(); }
});

test("social four-sided padding and strikethrough survive the applied design", async () => {
  const ui = await mount();
  try {
    await ui.click("Social links"); await ui.click("Edit social padding individual sides");
    await ui.set("Block padding top", "9"); await ui.set("Block padding bottom", "18");
    await ui.click("Text labels"); await ui.click("strikethrough"); const result = await ui.snapshot();
    assert.equal(result.blocks[0].presentation.padding!.top, 9); assert.equal(result.blocks[0].presentation.padding!.bottom, 18);
    assert.equal(result.blocks[0].presentation.strike, true); assert.match(designTools.renderEmailDesign(result).html, /line-through/);
  } finally { await ui.dispose(); }
});

test("header navigation typography controls affect the actual rendered links and mobile layout", async () => {
  const ui = await mount();
  try {
    await ui.click("Header bar"); await ui.click("Add link"); await ui.set("Link 1 label", "Shop"); await ui.set("Link 1 URL", "https://shop.test");
    assert.equal(ui.field("Font size").value, "14");
    await ui.set("Font size", "18"); await ui.set("Text color hex value", "#123456");
    await ui.set("Logo layout", "reverse"); await ui.set("Mobile logo layout", "links-only");
    await act(() => ui.field("Use same logo as desktop").click()); await ui.set("Mobile logo URL", "https://example.test/mobile.png");
    const result = await ui.snapshot();
    assert.equal(result.blocks[0].presentation.header!.linkSize, 18); assert.equal(result.blocks[0].presentation.header!.linkColor, "#123456");
    const document = new JSDOM(designTools.renderEmailDesign(result).html).window.document;
    assert.match(document.querySelector(".email-header-links td")!.getAttribute("style")!, /color:#123456;font-size:18px/);
    assert.equal(new JSDOM(designTools.renderEmailDesign(result, { viewport: "mobile" }).html).window.document.querySelector(".email-header-logo"), null);
  } finally { await ui.dispose(); }
});
for (const [label, type] of palette) test(`editor palette: ${label} adds an editable ${type} block`, async () => {
  const ui = await mount();
  try { await ui.click(label); const result = await ui.snapshot(); assert.equal(result.blocks.length, 1); assert.equal(result.blocks[0].type, type); assert.equal(ui.host.querySelector(".email-designer-sidebarTitle strong")!.textContent, label); assert.equal(ui.host.querySelector("[data-block-id]")?.getAttribute("data-block-id"), result.blocks[0].id); assert.ok(designTools.emailDesignSchema.safeParse(result).success); if (label === "Drop shadow") assert.equal(result.blocks[0].shadow, true); }
  finally { await ui.dispose(); }
});

for (const [label, type] of palette) test(`editor drag source: ${label} drops into the canvas`, async () => {
  const ui = await mount();
  try { const payload = await ui.dragStart(label); await ui.drag(payload); const result = await ui.snapshot(); assert.equal(result.blocks.length, 1); assert.equal(result.blocks[0].type, type); if (label === "Drop shadow") assert.equal(result.blocks[0].shadow, true); }
  finally { await ui.dispose(); }
});

test("inline typing selects the block, survives Done without a prior blur, and supports undo/redo", async () => {
  const initial = designTools.newEmailDesign("Original", "text"); const ui = await mount(initial);
  try {
    const text = ui.host.querySelector<HTMLElement>("[contenteditable]")!;
    await act(() => { text.focus(); text.click(); text.textContent = "Final typed text"; text.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    assert.ok(ui.field("Text"));
    assert.equal((await ui.snapshot()).blocks[0].text, "Final typed text");
    await ui.click("Undo"); assert.equal(ui.host.querySelector("[contenteditable]")!.textContent, "Original");
    await ui.click("Redo"); assert.equal(ui.host.querySelector("[contenteditable]")!.textContent, "Final typed text");
  } finally { await ui.dispose(); }
});

test("all block formatting controls update the applied and rendered design", async () => {
  const ui = await mount();
  try {
    await ui.click("Text"); await ui.set("Text", "Formatted copy");
    for (const name of ["bold", "italic", "underline", "Align right"]) await ui.click(name);
    await ui.set("Font", "Georgia"); await ui.set("Font size", "24"); await ui.set("Text color hex value", "#123456"); await ui.set("Background color hex value", "#abcdef"); await ui.set("Block padding vertical", "32"); await ui.set("Block padding horizontal", "32"); await ui.set("Corner radius", "12");
    const checkbox = ui.field("Drop shadow"); await act(() => checkbox.click());
    const result = await ui.snapshot(), block = result.blocks[0];
    assert.equal(block.text, "Formatted copy"); assert.equal(block.fontFamily, "Georgia"); assert.equal(block.fontSize, 24); assert.equal(block.color, "#123456"); assert.equal(block.background, "#abcdef"); assert.equal(block.padding, 32); assert.equal(block.radius, 12); assert.ok(block.bold && block.italic && block.underline && block.shadow); assert.equal(block.align, "right");
    const html = designTools.renderEmailDesign(result).html;
    for (const text of ["font-size:24px", "font-weight:bold", "font-style:italic", "text-decoration:underline", "text-align:right", "padding:32px", "border-radius:12px", "box-shadow:", "#123456", "#abcdef"]) assert.ok(html.includes(text), text);
  } finally { await ui.dispose(); }
});

test("theme controls keep their last values through Save and new blocks inherit the style", async () => {
  const ui = await mount();
  try {
    await ui.click("Edit styles"); await ui.set("Template background hex value", "#112233"); await ui.set("Content background hex value", "#ffeedd"); await ui.set("Accent color hex value", "#008800"); await ui.set("Background image", "https://example.test/background.png"); await ui.set("Width", "720"); await ui.set("Corner radius", "18"); await ui.set("Margin top", "40"); await ui.set("Padding", "24"); await ui.set("Font", "Verdana"); await ui.set("Font size", "20"); await ui.set("Text color hex value", "#445566");
    await ui.click("Add content"); await ui.click("Text"); await ui.set("Text", "Styled body"); await ui.click("Save as template");
    assert.equal(ui.saved.length, 1); const result = ui.saved[0].design;
    assert.deepEqual(result.theme, { background: "#112233", contentBackground: "#ffeedd", accent: "#008800", width: 720, radius: 18, marginTop: 40, padding: 24, fontFamily: "Verdana", fontSize: 20, textColor: "#445566", backgroundImage: "https://example.test/background.png" });
    assert.equal(result.blocks[0].fontSize, 20); assert.equal(result.blocks[0].color, "#445566"); assert.equal(result.blocks[0].fontFamily, "Verdana");
    const html = designTools.renderEmailDesign(result).html; assert.match(html, /background-image:/); assert.match(html, /max-width:720px/);
  } finally { await ui.dispose(); }
});

test("drag insertion, nested layout text insertion, resizing columns, and invalid drops preserve content", async () => {
  const ui = await mount();
  try {
    await ui.click("Columns"); let result = await ui.snapshot(); const columns = result.blocks[0];
    await ui.drag({ type: "text" }, columns.id, 1); result = await ui.snapshot(); const right = result.blocks.find(block => block.parentId === columns.id)!;
    assert.equal(right.column, 1); assert.ok(ui.field("Text"));
    await ui.drag({ type: "button" }, columns.id, 0); result = await ui.snapshot(); const button = result.blocks.find(block => block.type === "button")!;
    await ui.drag({ id: right.id }, columns.id, 0, button.id); result = await ui.snapshot(); assert.equal(result.blocks.find(block => block.id === right.id)!.column, 0);
    await ui.drag({ id: columns.id }, columns.id, 0); assert.match(ui.host.textContent!, /valid destination/); assert.equal((await ui.snapshot()).blocks.length, 3);
    await act(() => ui.host.querySelector<HTMLElement>(`[data-block-id="${columns.id}"]`)!.click()); await ui.click("Styles"); await ui.set("Columns", "3");
    await ui.drag({ type: "image" }, columns.id, 2); result = await ui.snapshot(); const image = result.blocks.find(block => block.type === "image")!;
    await act(() => ui.host.querySelector<HTMLElement>(`[data-block-id="${columns.id}"]`)!.click()); await ui.set("Columns", "2"); result = await ui.snapshot(); assert.equal(result.blocks.find(block => block.id === image.id)!.column, 1);
    await ui.click("Add text to layout column 1"); assert.ok(ui.field("Text"));
    assert.ok(designTools.emailDesignSchema.safeParse(await ui.snapshot()).success);
  } finally { await ui.dispose(); }
});

test("image uploads retain edits made while reading and reject bad files", async () => {
  const ui = await mount(undefined, true);
  try {
    await ui.click("Image"); await ui.upload(); assert.equal(ui.findButton("Done").disabled, true);
    await ui.set("Image width", "240"); await ui.set("Alt text", "Custom before upload"); await ui.finishUpload();
    const result = await ui.snapshot(); assert.equal(result.blocks[0].width, 240); assert.equal(result.blocks[0].src, "data:image/png;base64,AAAA"); assert.equal(result.blocks[0].alt, "Custom before upload");
    await ui.upload("application/pdf"); assert.match(ui.host.textContent!, /PNG, JPG, GIF, or WebP/);
    await ui.upload("image/png", 10 * 1024 * 1024 + 1); assert.match(ui.host.textContent!, /10 MB/);
    await ui.click("Remove image"); assert.equal((await ui.snapshot()).blocks[0].src, "");
  } finally { await ui.dispose(); }
});

test("pre-built layouts require confirmation, retain styles, and can be undone", async () => {
  for (const [label, kind] of [["Welcome email", "welcome"], ["Product spotlight", "products"], ["Newsletter", "newsletter"]] as const) {
    const initial = designTools.newEmailDesign("Keep this copy", "text"); initial.theme.background = "#aabbcc"; const ui = await mount(initial);
    try {
      await ui.click("Pre-built");
      await act(() => { const layout = [...ui.host.querySelectorAll<HTMLButtonElement>(".email-designer-prebuilt button")].find(node => node.querySelector("strong")?.textContent === label); assert.ok(layout); layout.click(); });
      assert.match(ui.host.textContent!, /Replace the current layout/); await ui.click("Replace layout"); const result = await ui.snapshot();
      assert.deepEqual(result.blocks.map(block => block.type), editorState.createEmailPrebuilt(kind).blocks.map(block => block.type)); assert.equal(result.theme.background, "#aabbcc");
      await ui.click("Undo"); assert.equal((await ui.snapshot()).blocks[0].text, "Keep this copy");
    } finally { await ui.dispose(); }
  }
});

for (const [paletteLabel, expected, values] of [
  ["Text", "Body content", [["Text", "Body content"]]],
  ["Button", "View offer", [["Button text", "View offer"], ["Link URL", "https://example.test/offer"]]],
  ["Header bar", "Our brand", [["Logo text", "Our brand"], ["Link 1 label", "News"], ["Link 1 URL", "https://example.test/news"]]],
  ["Coupon", "SAVE20", [["Coupon code", "SAVE20"], ["Heading", "Your code"]]],
  ["Review quote", "A happy customer", [["Text", "A happy customer"], ["Heading", "Jane Doe"]]],
  ["Product", "Custom product", [["Heading", "Custom product"], ["Text", "Product detail"], ["Image URL", "https://example.test/item.png"], ["Alt text", "Product image"], ["Link URL", "https://example.test/item"], ["Image width", "280"]]],
  ["Video", "Watch our video", [["Text", "Watch our video"], ["Image URL", "https://example.test/video.png"], ["Alt text", "Video thumbnail"], ["Video URL", "https://example.test/video"], ["Image width", "320"]]],
  ["Image", "A useful image", [["Image URL", "https://example.test/image.png"], ["Alt text", "A useful image"], ["Image width", "200"], ["Link URL", "https://example.test/image-link"]]],
  ["HTML", "Custom markup", [["HTML content", "<p>Custom markup</p><a href='https://example.test/html'>HTML link</a><script>unsafe()</script>"]]],
] as Array<[string, string, Array<[string, string]>]>) test(`editor content: ${paletteLabel} fields reach preview, export, and applied design`, async () => {
  const ui = await mount();
  try {
    await ui.click(paletteLabel); if (paletteLabel === "Header bar") await ui.click("Add link");
    for (const [label, value] of values) await ui.set(label, value);
    if (paletteLabel === "Image") await ui.click("Align right");
    const result = await ui.snapshot(), html = designTools.renderEmailDesign(result).html;
    assert.ok(html.includes(expected), paletteLabel); assert.doesNotMatch(html, /unsafe\(\)/);
    if (paletteLabel === "Image") { assert.match(html, /margin:0 0 0 auto/); assert.match(html, /width="200"/); }
    if (paletteLabel === "Button") { assert.match(html, /background:#0b494c/); assert.match(html, /font-weight:inherit/); const page = new JSDOM(html).window.document; assert.match(page.querySelector("a")!.parentElement!.getAttribute("style")!, /background:transparent/); }
    await ui.click("Preview"); const iframe = ui.host.querySelector<HTMLIFrameElement>("iframe[title='Designed email preview']")!; assert.ok(iframe.srcdoc.includes(expected));
    await ui.click("Export HTML"); assert.equal(ui.downloads.length, 1); assert.equal(ui.downloads[0].filename, "Audit-email.html");
  } finally { await ui.dispose(); }
});

test("social links can be added, edited, removed, and rendered", async () => {
  const ui = await mount();
  try {
    await ui.click("Social links"); await ui.set("Link 1 label", "Website"); await ui.set("Link 1 URL", "https://example.test"); await ui.click("Add icon"); await ui.set("Link 2 label", "LinkedIn"); await ui.set("Link 2 URL", "https://example.test/linkedin");
    const result = await ui.snapshot(); assert.equal(result.blocks[0].links.length, 5); assert.match(designTools.renderEmailDesign(result).html, /LinkedIn/);
    await ui.click("Remove Twitter 5"); assert.equal((await ui.snapshot()).blocks[0].links.length, 4);
  } finally { await ui.dispose(); }
});

test("social controls persist platforms, labels, styles, mobile stacking, padding and display", async () => {
  const ui = await mount();
  try {
    await ui.click("Social links");
    assert.equal(ui.host.querySelectorAll(".email-social-card").length, 4);
    assert.equal(ui.host.querySelector(".email-social-card")!.hasAttribute("open"), false);
    await ui.set("Link 1 platform", "linkedin");
    await ui.set("Link 1 URL", "https://example.test/linkedin");
    assert.equal(ui.field("Link 1 label").value, "LinkedIn");
    await ui.click("Text labels"); await ui.set("Font size", "18"); await ui.set("Text color hex value", "#445566");
    await ui.set("Icon size", "large"); await ui.set("Icon color", "white"); await ui.set("Icon spacing", "18");
    await act(() => (ui.field("Stack on mobile") as HTMLInputElement).click());
    await ui.click("Link padding values"); await ui.set("Vertical padding", "9"); await ui.set("Horizontal padding", "7");
    await ui.click("Mobile preview");
    assert.equal(ui.host.querySelectorAll(".email-designer-page table.email-social tr").length, 4);
    await ui.click("Display"); await act(() => (ui.field("Show on desktop") as HTMLInputElement).click());
    await ui.click("Desktop preview"); assert.match(ui.host.textContent!, /hidden on desktop/);
    const result = await ui.snapshot(), block = result.blocks[0];
    assert.equal(block.links[0].platform, "linkedin");
    assert.equal(block.social.showLabels, true); assert.equal(block.social.stackMobile, true);
    assert.equal(block.social.iconColor, "white"); assert.equal(block.social.iconSize, "large");
    assert.equal(block.social.gap, 18); assert.equal(block.social.paddingY, 9); assert.equal(block.social.paddingX, 7);
    assert.equal(block.social.showDesktop, false); assert.equal(block.color, "#445566"); assert.equal(block.fontSize, 18);
    await ui.click("Save as template"); assert.deepEqual(ui.saved[0].design, result);
    await ui.click("Preview"); assert.match(ui.host.querySelector<HTMLIFrameElement>("iframe")!.srcdoc, /email-social-hide-desktop/);
  } finally { await ui.dispose(); }
});

test("social icon and spacer ordering works with buttons, keyboard and drag without losing URLs", async () => {
  const ui = await mount();
  try {
    await ui.click("Social links"); await ui.set("Link 1 URL", "https://example.test/facebook");
    await ui.click("Add spacer"); await ui.set("Spacer 5 width", "28");
    await ui.click("Move item 5 up");
    let result = await ui.snapshot(); assert.equal(result.blocks[0].links[3].kind, "spacer");
    await act(() => ui.findButton("Reorder Spacer 4").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })));
    result = await ui.snapshot(); assert.equal(result.blocks[0].links[2].kind, "spacer");
    const payload = new Map<string, string>();
    const handle = ui.findButton("Reorder Spacer 3");
    await act(() => { const event = new dom.window.Event("dragstart", { bubbles: true }); Object.defineProperty(event, "dataTransfer", { value: { setData: (type: string, value: string) => payload.set(type, value), effectAllowed: "" } }); handle.dispatchEvent(event); });
    const target = ui.host.querySelector<HTMLElement>('[data-social-index="0"]')!;
    await act(() => { const event = new dom.window.Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { getData: (type: string) => payload.get(type) } }); target.dispatchEvent(event); });
    result = await ui.snapshot(); assert.equal(result.blocks[0].links[0].kind, "spacer"); assert.equal(result.blocks[0].links[0].spacerWidth, 28);
    assert.equal(result.blocks[0].links[1].href, "https://example.test/facebook");
    await ui.click("Undo"); assert.equal((await ui.snapshot()).blocks[0].links[2].kind, "spacer");
    await ui.click("Redo"); assert.equal((await ui.snapshot()).blocks[0].links[0].kind, "spacer");
    await ui.click("Remove Spacer 1"); assert.equal((await ui.snapshot()).blocks[0].links.length, 4);
  } finally { await ui.dispose(); }
});

test("product catalog selection fills the editable product fields", async () => {
  const ui = await mount();
  try { await ui.click("Product"); await ui.set("Product", "PLA"); const result = await ui.snapshot(); assert.equal(result.blocks[0].heading, "PLA filament"); assert.equal(result.blocks[0].text, "PLA"); assert.equal(result.blocks[0].src, "https://example.test/product.png"); }
  finally { await ui.dispose(); }
});

test("divider and spacer dimensions and colors survive preview", async () => {
  for (const name of ["Divider", "Spacer"]) {
    const ui = await mount();
    try { await ui.click(name); await ui.set("Height", "48"); if (name === "Divider") await ui.set("Line color hex value", "#445566"); await ui.set("Corner radius", "8"); const result = await ui.snapshot(); assert.equal(result.blocks[0].height, 48); assert.match(designTools.renderEmailDesign(result).html, /height:48px/); if (name === "Spacer") assert.equal(result.blocks[0].padding, 0); else assert.match(designTools.renderEmailDesign(result).html, /background:#445566;border-radius:8px/); }
    finally { await ui.dispose(); }
  }
});

test("table edits are flushed before Done, align with the selected option, and reject oversized tables without truncation", async () => {
  const ui = await mount();
  try {
    await ui.click("Table"); await ui.set("Table content", "Name | Detail\nExample | Value"); await ui.click("Align center"); let result = await ui.snapshot(); assert.deepEqual(result.blocks[0].rows, [["Name", "Detail"], ["Example", "Value"]]); assert.match(designTools.renderEmailDesign(result).html, /text-align:center/);
    await ui.set("Table content", Array.from({ length: 21 }, (_, i) => String(i)).join("\n")); const count = ui.applied.length; await ui.click("Done"); assert.equal(ui.applied.length, count); assert.match(ui.host.textContent!, /at most 20 rows/);
    await ui.set("Table content", "One | Two", true); result = await ui.snapshot(); assert.deepEqual(result.blocks[0].rows, [["One", "Two"]]);
  } finally { await ui.dispose(); }
});

test("transparent backgrounds, invalid colors, and numeric limits have consistent values on Done", async () => {
  const ui = await mount();
  try {
    await ui.click("Text"); await ui.set("Block padding vertical", "999"); let result = await ui.snapshot(); assert.equal(blockConfig.blockInsets(result.blocks[0]).top, 80);
    await ui.set("Block padding vertical", ""); result = await ui.snapshot(); assert.equal(blockConfig.blockInsets(result.blocks[0]).top, 80);
    await ui.set("Text color hex value", "#abc", true); result = await ui.snapshot(); assert.equal(result.blocks[0].color, "#aabbcc");
    await ui.set("Text color hex value", "invalid", true); result = await ui.snapshot(); assert.equal(result.blocks[0].color, "#aabbcc");
    await ui.set("Background color hex value", "#ffffff"); const transparent = ui.field("Transparent background") as HTMLInputElement; assert.equal(transparent.checked, false); await act(() => transparent.click()); assert.equal(transparent.checked, true); assert.equal(ui.field("Background color hex value").value, "transparent"); assert.equal((await ui.snapshot()).blocks[0].background, "transparent");
  } finally { await ui.dispose(); }
});

test("duplicate, move up/down, delete, clear, undo, and redo preserve exact block order", async () => {
  const ui = await mount();
  try {
    await ui.click("Text"); await ui.set("Text", "First"); await ui.click("Duplicate selected block"); await ui.set("Text", "Second");
    await ui.click("Move block up"); assert.deepEqual((await ui.snapshot()).blocks.map(block => block.text), ["Second", "First"]);
    await ui.click("Move block down"); assert.deepEqual((await ui.snapshot()).blocks.map(block => block.text), ["First", "Second"]);
    await ui.click("Delete selected block"); assert.equal((await ui.snapshot()).blocks.length, 1); await ui.click("Undo"); assert.equal((await ui.snapshot()).blocks.length, 2);
    await ui.click("Clear content"); await ui.click("Clear content"); assert.equal((await ui.snapshot()).blocks.length, 0); await ui.click("Undo"); assert.equal((await ui.snapshot()).blocks.length, 2); await ui.click("Redo"); assert.equal((await ui.snapshot()).blocks.length, 0);
  } finally { await ui.dispose(); }
});

test("desktop/mobile canvas and preview controls retain all columns and content", async () => {
  const initial = editorState.createEmailPrebuilt("newsletter"); const ui = await mount(initial);
  try {
    await ui.click("Mobile preview"); assert.equal((ui.host.querySelector(".email-designer-page") as HTMLElement).style.width, "375px"); await ui.click("Preview"); assert.equal(ui.host.querySelector<HTMLIFrameElement>("iframe")!.style.width, "375px"); await ui.click("Desktop"); assert.equal(ui.host.querySelector<HTMLIFrameElement>("iframe")!.style.width, "100%"); assert.match(ui.host.querySelector<HTMLIFrameElement>("iframe")!.srcdoc, /Your latest update/);
    assert.deepEqual(await ui.snapshot(), initial);
  } finally { await ui.dispose(); }
});

test("save/create-as-new, title-only unsaved changes, empty content, and save failures are handled", async () => {
  const ui = await mount();
  try {
    await ui.set("Template name", "Renamed"); await ui.click("Back to message"); assert.match(ui.host.textContent!, /Discard editor changes/); await ui.click("Keep editing");
    await ui.click("Save as template"); assert.equal(ui.saved.length, 0); assert.match(ui.host.textContent!, /Add email content/);
    await ui.click("Text"); await ui.set("Text", "Saved body"); await ui.click("Save as template"); assert.equal(ui.saved[0].name, "Renamed"); assert.equal(ui.saved[0].existing, null);
    await ui.click("Save template"); assert.equal((ui.saved[1].existing as { id: string }).id, "saved-template"); await ui.click("Save as new template"); assert.equal(ui.saved[2].existing, null);
  } finally { await ui.dispose(); }
  const failed = await mount(designTools.newEmailDesign("Body", "text"), false, "Verification save failure");
  try { await failed.click("Save as template"); assert.match(failed.host.textContent!, /Verification save failure/); assert.equal(failed.findButton("Done").disabled, false); }
  finally { await failed.dispose(); }
});

test("paste inserts plain text and keyboard undo/redo work inside the canvas", async () => {
  const ui = await mount(designTools.newEmailDesign("Original", "text"));
  try {
    const editable = ui.host.querySelector<HTMLElement>("[contenteditable]")!;
    await act(() => { editable.focus(); const event = new dom.window.Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { getData: () => "<b>Plain pasted copy</b>" } }); editable.dispatchEvent(event); });
    assert.equal(editable.querySelector("b"), null); assert.match((await ui.snapshot()).blocks[0].text, /Plain pasted copy/);
    await act(() => editable.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))); assert.equal((await ui.snapshot()).blocks[0].text, "Original");
    await act(() => editable.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true }))); assert.match((await ui.snapshot()).blocks[0].text, /Plain pasted copy/);
  } finally { await ui.dispose(); }
});

test("upload completion never resurrects a deleted block and a ninth inline image is rejected", async () => {
  const ui = await mount(undefined, true);
  try { await ui.click("Image"); await ui.upload(); await ui.click("Delete selected block"); await ui.finishUpload(); assert.equal((await ui.snapshot()).blocks.length, 0); }
  finally { await ui.dispose(); }
  const images = Array.from({ length: 8 }, () => designTools.newEmailBlock("image", { src: "data:image/png;base64,AAAA" }));
  const limited = await mount({ ...designTools.newEmailDesign(), blocks: images }, true);
  try { await limited.click("Image"); await limited.upload(); await limited.finishUpload(); assert.match(limited.host.textContent!, /up to eight uploaded images/); const result = await limited.snapshot(); assert.equal(result.blocks.filter(block => block.src.startsWith("data:")).length, 8); }
  finally { await limited.dispose(); }
});

test("the maximum block limit refuses extra blocks without corrupting the current design", async () => {
  const initial = { ...designTools.newEmailDesign(), blocks: Array.from({ length: 200 }, () => designTools.newEmailBlock("text")) }; const ui = await mount(initial);
  try { await ui.click("Text"); assert.equal((await ui.snapshot()).blocks.length, 200); await ui.click("Duplicate block"); assert.equal((await ui.snapshot()).blocks.length, 200); assert.ok(designTools.emailDesignSchema.safeParse(await ui.snapshot()).success); }
  finally { await ui.dispose(); }
});

test("block search filters content and layouts and supports empty results and clearing", async () => {
  const ui = await mount();
  try {
    assert.equal(ui.findButton("Edit selected block").disabled, true);
    await ui.set("Search blocks", "  IMAGE  ");
    assert.equal(ui.host.querySelectorAll(".email-designer-palette button").length, 1);
    await ui.click("Image");
    assert.equal(ui.findButton("Edit selected block").getAttribute("aria-pressed"), "true");
    await ui.click("Add content"); await ui.set("Search blocks", "columns");
    assert.equal(ui.host.querySelectorAll(".email-designer-palette button").length, 1);
    await ui.click("Columns");
    await ui.click("Add content"); await ui.set("Search blocks", "unknown block");
    assert.match(ui.host.textContent!, /No matching blocks/);
    await ui.click("Clear block search");
    assert.equal(ui.host.querySelectorAll(".email-designer-palette button").length, 17);
    assert.deepEqual((await ui.snapshot()).blocks.map(block => block.type), ["image", "columns"]);
  } finally { await ui.dispose(); }
});

test("nested layers select the right block and Design/Styles navigation retains edits", async () => {
  const initial = editorState.createEmailPrebuilt("products");
  const target = initial.blocks.find(block => block.type === "product" && block.parentId)!;
  target.heading = "Nested audit product";
  const ui = await mount(initial);
  try {
    await ui.click("Layers");
    assert.equal(ui.host.querySelectorAll(".email-designer-layer").length, initial.blocks.length);
    assert.ok(ui.host.querySelector(".email-designer-layerList .email-designer-layerList"));
    await ui.click(`Select Product layer: ${(target.heading || target.text).slice(0, 60)}`);
    assert.equal(ui.field("Text").value, target.text);
    await ui.set("Text", "Updated nested copy");
    await ui.click("Edit styles"); await ui.set("Font size", "18");
    await ui.click("Edit selected block");
    assert.equal(ui.field("Text").value, "Updated nested copy");
    const summary = [...ui.host.querySelectorAll("summary")].find(node => node.textContent === "Custom product content")!;
    const wasOpen = summary.parentElement!.hasAttribute("open");
    await act(() => summary.click());
    assert.equal(summary.parentElement!.hasAttribute("open"), !wasOpen);
    assert.equal((await ui.snapshot()).blocks.find(block => block.id === target.id)!.text, "Updated nested copy");
  } finally { await ui.dispose(); }
});

test("canvas zoom is a view preference and never changes the exported design", async () => {
  const initial = editorState.createEmailPrebuilt("newsletter");
  const ui = await mount(initial);
  try {
    await ui.set("Canvas zoom", "75");
    assert.equal((ui.host.querySelector(".email-designer-page") as HTMLElement).style.zoom, "0.75");
    await ui.click("Mobile preview");
    assert.equal((ui.host.querySelector(".email-designer-page") as HTMLElement).style.width, "375px");
    assert.deepEqual(await ui.snapshot(), initial);
  } finally { await ui.dispose(); }
});

test("sidebar resize supports keyboard limits, saved width, and reset", async () => {
  const key = "filazoo:column:email-design-sidebar";
  dom.window.localStorage.setItem(key, "340");
  const ui = await mount();
  try {
    const shell = ui.host.querySelector<HTMLElement>(".email-designer-shell")!;
    const sidebar = ui.host.querySelector<HTMLElement>(".email-designer-sidebar")!;
    const workspace = ui.host.querySelector<HTMLElement>(".email-designer-workspace")!;
    const handle = ui.host.querySelector<HTMLElement>("[role=separator]")!;
    assert.equal(shell.style.getPropertyValue("--email-editor-sidebar-width"), "340px");
    sidebar.getBoundingClientRect = () => ({ width: Number.parseInt(shell.style.getPropertyValue("--email-editor-sidebar-width")) || 320 } as DOMRect);
    workspace.getBoundingClientRect = () => ({ width: 900 } as DOMRect);
    for (const [keyName, expected] of [["ArrowRight", "350px"], ["End", "440px"], ["Home", "288px"]]) {
      await act(() => handle.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: keyName, bubbles: true })));
      assert.equal(shell.style.getPropertyValue("--email-editor-sidebar-width"), expected);
      assert.equal(dom.window.localStorage.getItem(key), expected.replace("px", ""));
    }
    await act(() => handle.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true })));
    assert.equal(shell.style.getPropertyValue("--email-editor-sidebar-width"), "");
    assert.equal(dom.window.localStorage.getItem(key), null);
  } finally { dom.window.localStorage.removeItem(key); await ui.dispose(); }
});

test("collapsing and reopening the inspector keeps the selected block and edits", async () => {
  const ui = await mount();
  try {
    await ui.click("Text"); await ui.set("Text", "Keep this content");
    const scroll = ui.host.querySelector<HTMLElement>(".email-designer-sidebarScroll")!;
    scroll.scrollTop = 200;
    await ui.click("Edit styles"); assert.equal(scroll.scrollTop, 0);
    await ui.click("Edit selected block");
    await ui.click("Collapse design sidebar");
    assert.equal(ui.host.querySelector(".email-designer-shell")!.getAttribute("data-sidebar-collapsed"), "true");
    assert.ok(ui.host.querySelector("aside")!.hasAttribute("inert"));
    await ui.click("Expand design sidebar");
    assert.equal(ui.field("Text").value, "Keep this content");
    assert.equal((await ui.snapshot()).blocks[0].text, "Keep this content");
  } finally { await ui.dispose(); }
});

test("number steppers respect the allowed range and update preview styles", async () => {
  const ui = await mount();
  try {
    await ui.click("Text");
    assert.equal(ui.findButton("Decrease corner radius").disabled, true);
    await ui.click("Increase corner radius");
    assert.equal(ui.field("Corner radius").value, "1");
    assert.equal((await ui.snapshot()).blocks[0].radius, 1);
    await ui.set("Corner radius", "40");
    assert.equal(ui.findButton("Increase corner radius").disabled, true);
    await ui.click("Decrease corner radius");
    assert.equal((await ui.snapshot()).blocks[0].radius, 39);
  } finally { await ui.dispose(); }
});

test("the image drop component uses the same file validation and upload lifecycle as selection", async () => {
  const ui = await mount(undefined, true);
  try {
    await ui.click("Image");
    const drop = ui.host.querySelector<HTMLElement>(".email-designer-uploadDrop")!;
    async function dropFile(type: string) {
      await act(() => {
        const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: { files: [new dom.window.File([new Uint8Array(4)], "dropped.png", { type })] } });
        drop.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
      });
    }
    await dropFile("text/plain"); assert.match(ui.host.textContent!, /Choose a PNG/);
    await dropFile("image/png"); await ui.finishUpload();
    assert.equal(ui.host.querySelector(".email-designer-uploadDrop")!.getAttribute("data-has-image"), "true");
    assert.equal((await ui.snapshot()).blocks[0].src, "data:image/png;base64,AAAA");
  } finally { await ui.dispose(); }
});
