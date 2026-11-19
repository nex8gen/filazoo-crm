import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as content from "../lib/product-content.ts";
import * as images from "../lib/product-images.ts";
import * as media from "../lib/product-media.ts";
import * as inventory from "../lib/product-inventory.ts";
import * as quantities from "../lib/quantity-pricing.ts";
import * as products from "../lib/product-utils.ts";
import * as variantTools from "../lib/product-variants.ts";
import * as pricing from "../lib/product-pricing.ts";
import * as sharedInventory from "../lib/shared-product-inventory.ts";
import * as markup from "../lib/email-markup.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";
import type { Product } from "../lib/types.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://crm.test/products", pretendToBeVisual: true });
for (const key of ["document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLFormElement", "SVGElement", "Element", "Node", "NodeFilter", "ShadowRoot", "DocumentFragment", "MutationObserver", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: dom.window.requestAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: dom.window.cancelAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);

async function mount(canWrite = true, overrides: Partial<Product> = {}, insideSheet = false) {
  let compact = false;
  const mediaListeners = new Set<() => void>();
  dom.window.matchMedia = query => ({
    matches: query === "(max-width: 640px)" && compact,
    addEventListener: (_: string, listener: () => void) => { if (query === "(max-width: 640px)") mediaListeners.add(listener); },
    removeEventListener: (_: string, listener: () => void) => { mediaListeners.delete(listener); },
    addListener() {}, removeListener() {},
  }) as unknown as MediaQueryList;
  const forms: FormData[] = [];
  const commands: Array<[string, string | undefined]> = [];
  const cache = new Map<string, unknown>();
  const saved: unknown[] = [];
  let closeRequests = 0;
  const dependencies: Record<string, unknown> = {
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "next/image": { default: (props: Record<string, unknown>) => { const image = { ...props }; delete image.unoptimized; return React.createElement("img", image); } },
    "next/link": { default: (props: Record<string, unknown>) => React.createElement("a", props) },
    "@/components/data-state": {}, "@/components/page-header": {}, "@/components/workspace-memory": {},
    "@/lib/motion-features": { default: require("motion/react").domAnimation },
    "@/components/ui/table-filters": {}, "@/components/ui/table-pagination": {},
    "@/components/ui/notification-toast": { NotificationToast: ({ children }: { children: React.ReactNode }) => React.createElement("div", { role: "alert" }, children) },
    "@/components/product-image-picker": { ProductImagePicker: () => null, uploadProductImage: async () => "https://example.com/upload.png" },
    "@/app/crm-actions": { updateProduct: async (_: unknown, form: FormData) => { forms.push(form); return { success: "Saved" }; } },
    "@/lib/product-utils": products, "@/lib/product-images": images, "@/lib/product-inventory": inventory,
    "@/lib/product-media": media,
    "@/lib/product-media-upload": { uploadCompanyMedia: async (file: File) => ({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size, createdAt: new Date().toISOString(), url: "https://example.com/upload.png" }) },
    "@/lib/product-content": content, "@/lib/quantity-pricing": quantities, "@/lib/email-markup": markup,
    "@/lib/product-variants": variantTools, "@/lib/product-pricing": pricing,
    "@/lib/shared-product-inventory": sharedInventory,
    "@/app/product-stock-actions": { loadProductStock: async () => ({ stock: { locations: [] }, history: [] }), adjustProductStock: async () => ({ revision: "new-revision" }) },
    "@/lib/utils": require("cn"),
    sonner: { toast: { success() {}, error() {} } },
  };
  function load<T>(file: string): T {
    if (cache.has(file)) return cache.get(file) as T;
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { exports, document, window: dom.window, FormData: dom.window.FormData, crypto, fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args), setTimeout, clearTimeout, AbortController, URLSearchParams, require: (name: string) => {
      if (name.endsWith(".css")) return {};
      if (dependencies[name]) return dependencies[name];
      if (name.startsWith("@/components/")) return load(`components/${name.slice("@/components/".length)}.tsx`);
      return require(name);
    } });
    return exports as T;
  }
  document.execCommand = (command: string, _showUI?: boolean, value?: string) => {
    commands.push([command, value]);
    if (command === "insertHTML") document.querySelector('[aria-label="Description"][contenteditable]')!.insertAdjacentHTML("beforeend", value ?? "");
    return true;
  };
  const { ProductEditor } = load<typeof import("../components/products-catalog-v2.tsx")>("components/products-catalog-v2.tsx");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const product = { ...b2bProducts[0], description: "<p>Existing <strong>description</strong>.</p>", mediaUrls: ["https://example.com/cover.png", "https://example.com/second.png"], ...overrides };
  const editor = React.createElement(ProductEditor, { product, fullPage: true, canWrite, mode: "live", onSaved: value => saved.push(value), onOpenChange() { closeRequests++; } });
  const { ProductSheet } = load<typeof import("../components/product-profile-sheet.tsx")>("components/product-profile-sheet.tsx");
  await React.act(async () => root.render(insideSheet ? React.createElement(ProductSheet, { title: "Product details", open: true, onOpenChange: () => { closeRequests++; } }, editor) : editor));
  const surface = insideSheet ? document.querySelector<HTMLElement>(".product-profile-sheet")! : host;
  async function click(label: string) { await React.act(async () => surface.querySelector<HTMLElement>(`[aria-label="${label}"]`)!.click()); }
  async function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    await React.act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  }
  async function submit() { await React.act(async () => surface.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); }
  async function resize(small: boolean) { await React.act(async () => { compact = small; mediaListeners.forEach(listener => listener()); }); }
  return { host: surface, forms, saved, commands, click, change, submit, resize, closeRequests: () => closeRequests, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("media stays within two rows on desktop and mobile with an accurate overflow count", async () => {
  const mediaUrls = Array.from({ length: 15 }, (_, index) => `https://example.com/media-${index}.png`);
  const ui = await mount(true, { mediaUrls });
  try {
    const grid = ui.host.querySelector(".product-media-grid")!;
    assert.equal(grid.children.length, 9, "cover takes four cells and eight other tiles fill two six-column rows");
    assert.equal(grid.querySelectorAll(".product-media-item:not(.product-media-more)").length, 8);
    assert.equal(grid.lastElementChild?.textContent, "+7 more");
    assert.equal(ui.host.querySelector('[aria-label="Add product media"]'), null, "adding is hidden until the gallery expands");
    assert.equal(ui.host.querySelector(".product-media-footer"), null);
    await ui.resize(true);
    assert.equal(grid.children.length, 5, "cover and four other tiles fill two four-column rows");
    assert.equal(grid.lastElementChild?.textContent, "+11 more");
    await ui.resize(false);
    assert.equal(grid.children.length, 9);
    assert.equal(grid.lastElementChild?.textContent, "+7 more");
    await ui.submit();
    assert.deepEqual(JSON.parse(String(ui.forms[0].get("mediaUrls"))), mediaUrls, "hidden images remain saved");
  } finally { await ui.close(); }
});

for (const count of [0, 1, 4, 5, 8, 9, 20]) test(`two-row media handles ${count} images at each breakpoint`, async () => {
  const mediaUrls = Array.from({ length: count }, (_, index) => `https://example.com/media-${index}.png`);
  const ui = await mount(true, { mediaUrls, imageUrl: "" });
  try {
    for (const [compact, limit] of [[false, 8], [true, 4]] as const) {
      await ui.resize(compact);
      const grid = ui.host.querySelector(".product-media-grid")!;
      assert.ok(grid.children.length <= limit + 1);
      assert.equal(grid.querySelectorAll(".product-media-item:not(.product-media-more)").length, Math.min(count, limit));
      assert.equal(grid.querySelector(".product-media-more")?.textContent ?? null, count > limit ? `+${count - limit} more` : null);
    }
  } finally { await ui.close(); }
});

test("overflow expands media inline and edits hidden images without closing the product sheet", async () => {
  const mediaUrls = Array.from({ length: 15 }, (_, index) => `https://example.com/media-${index}.png`);
  const ui = await mount(true, { mediaUrls }, true);
  try {
    await ui.click("Show 7 more product images");
    const grid = ui.host.querySelector(".product-media-grid")!;
    assert.equal(grid.querySelectorAll(".product-media-item").length, 15);
    assert.equal(document.querySelector('[data-slot="dialog-content"]'), null);
    assert.equal(ui.host.querySelector(".product-media-more"), null);
    assert.ok(grid.querySelector('[aria-label="Add product media"]'));
    assert.ok(ui.host.querySelector(".product-media-help"));
    assert.equal(ui.host.querySelector('[aria-label="Show less product media"]')?.getAttribute("aria-controls"), grid.id);
    await ui.click("Use image 15 as cover");
    assert.equal(ui.host.querySelector('.product-media-cover img')?.getAttribute("src"), mediaUrls[14]);
    await ui.click("Remove product image 15");
    assert.equal(grid.querySelectorAll(".product-media-item").length, 14);
    await ui.click("Show less product media");
    assert.equal(grid.querySelectorAll(".product-media-item:not(.product-media-more)").length, 8);
    assert.equal(ui.host.querySelector(".product-media-more")?.textContent, "+6 more");
    assert.equal(ui.host.querySelector('[aria-label="Add product media"]'), null);
    assert.equal(ui.host.querySelector(".product-media-footer"), null);
    assert.equal(ui.closeRequests(), 0);
    assert.equal(ui.forms.length, 0, "gallery actions must not submit the product form");
    await ui.submit();
    const savedMedia = JSON.parse(String(ui.forms[0].get("mediaUrls")));
    assert.equal(savedMedia.length, 14);
    assert.equal(savedMedia[0], mediaUrls[14]);
    assert.ok(!savedMedia.includes(mediaUrls[13]));
  } finally { await ui.close(); }
});

test("read-only products can view hidden media without editing it", async () => {
  const mediaUrls = Array.from({ length: 10 }, (_, index) => `https://example.com/media-${index}.png`);
  const ui = await mount(false, { mediaUrls });
  try {
    await ui.click("Show 2 more product images");
    const grid = ui.host.querySelector(".product-media-grid")!;
    assert.equal(grid.querySelectorAll(".product-media-item").length, 10);
    assert.equal(ui.host.querySelectorAll(".product-media-controls, .product-media-add").length, 0);
    await ui.resize(true);
    assert.equal(grid.querySelectorAll(".product-media-item").length, 10, "expanded images stay visible after resizing");
    await ui.click("Show less product media");
    assert.equal(grid.querySelectorAll(".product-media-item:not(.product-media-more)").length, 4);
    assert.equal(grid.lastElementChild?.textContent, "+6 more");
    await ui.click("Show 6 more product images");
    assert.equal(grid.querySelectorAll(".product-media-item").length, 10);
  } finally { await ui.close(); }
});

test("Add media opens company storage, selects images and videos, and applies only on Done", async () => {
  const image = { id: "a1111111-1111-4111-8111-111111111111", name: "Spool.jpg", mimeType: "image/jpeg", size: 1024, createdAt: "2026-11-19", url: "/api/product-media/a1111111-1111-4111-8111-111111111111/media.jpg" };
  const video = { ...image, id: "b2222222-2222-4222-8222-222222222222", name: "Print.mp4", mimeType: "video/mp4", url: "/api/product-media/b2222222-2222-4222-8222-222222222222/media.mp4" };
  const previousFetch = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = async input => { const url = new URL(String(input), "https://crm.test"); requests.push(url); return Response.json({ items: url.searchParams.get("type") === "video" ? [video] : [image, video], total: url.searchParams.get("type") === "video" ? 1 : 2 }); };
  const ui = await mount(true, {}, true);
  try {
    await ui.click("Add product media");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const dialog = document.querySelector<HTMLElement>(".company-media-picker")!;
    assert.match(dialog.textContent ?? "", /Select media/);
    assert.equal(dialog.querySelectorAll(".company-media-tile").length, 2);
    assert.equal(dialog.querySelectorAll("video").length, 1);
    await React.act(async () => dialog.querySelector<HTMLElement>('[aria-label="Select Spool.jpg"]')!.click());
    await React.act(async () => dialog.querySelector<HTMLElement>('[aria-label="Company media type"]')!.click());
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "Videos")!.click());
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(dialog.querySelectorAll(".company-media-tile").length, 1);
    await React.act(async () => dialog.querySelector<HTMLElement>('[aria-label="Select Print.mp4"]')!.click());
    assert.match(dialog.querySelector(".company-media-footer")!.textContent ?? "", /^2 selected/);
    assert.equal(ui.host.querySelectorAll(".product-media-grid .product-media-item").length, 2, "selection is still a draft");
    assert.equal(ui.forms.length, 0);
    await React.act(async () => Array.from(dialog.querySelectorAll(".company-media-footer button")).find(button => button.textContent === "Done")!.click());
    assert.equal(Boolean(document.querySelector(".company-media-picker")), false);
    assert.equal(ui.host.querySelectorAll(".product-media-grid video").length, 1);
    assert.equal(ui.host.querySelector<HTMLInputElement>('input[name="imageUrl"]')!.value, "https://example.com/cover.png");
    assert.equal(ui.closeRequests(), 0);
    await ui.submit();
    assert.deepEqual(JSON.parse(String(ui.forms[0].get("mediaUrls"))), ["https://example.com/cover.png", "https://example.com/second.png", image.url, video.url]);
    assert.ok(requests.some(request => request.searchParams.get("type") === "video"));
  } finally { await ui.close(); globalThis.fetch = previousFetch; }
});

test("company media search, failed loading, retry, and Cancel preserve the product draft", async () => {
  const previousFetch = globalThis.fetch;
  let fail = true;
  const requests: string[] = [];
  globalThis.fetch = async input => { requests.push(String(input)); return fail ? Response.json({ error: "Storage is temporarily unavailable" }, { status: 503 }) : Response.json({ items: [], total: 0 }); };
  const ui = await mount(true, {}, true);
  try {
    await ui.click("Add product media");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const dialog = document.querySelector<HTMLElement>(".company-media-picker")!;
    assert.match(dialog.textContent ?? "", /Storage is temporarily unavailable/);
    fail = false;
    await React.act(async () => Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Try again")!.click());
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.match(dialog.textContent ?? "", /No images or videos in company storage yet/);
    await ui.change(dialog.querySelector<HTMLInputElement>('[aria-label="Search company media"]')!, "yellow");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.ok(requests.some(request => request.includes("q=yellow")));
    assert.match(dialog.textContent ?? "", /No matching media/);
    await React.act(async () => Array.from(dialog.querySelectorAll(".company-media-footer button")).find(button => button.textContent === "Cancel")!.click());
    assert.equal(Boolean(document.querySelector(".company-media-picker")), false);
    assert.equal(ui.closeRequests(), 0);
    await ui.submit();
    assert.deepEqual(JSON.parse(String(ui.forms[0].get("mediaUrls"))), ["https://example.com/cover.png", "https://example.com/second.png"]);
  } finally { await ui.close(); globalThis.fetch = previousFetch; }
});

test("company media respects remaining gallery capacity and Escape closes only the picker", async () => {
  const previousFetch = globalThis.fetch;
  const items = [1, 2].map(index => ({ id: String(index), name: `Photo ${index}.png`, mimeType: "image/png", size: 1234, createdAt: "2026-11-19", url: `https://example.com/library-${index}.png` }));
  globalThis.fetch = async () => Response.json({ items, total: 2 });
  const ui = await mount(true, { mediaUrls: Array.from({ length: 19 }, (_, index) => `https://example.com/media-${index}.png`) }, true);
  try {
    await ui.click("Show 11 more product images"); await ui.click("Add product media");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const dialog = document.querySelector<HTMLElement>(".company-media-picker")!;
    await React.act(async () => dialog.querySelector<HTMLElement>('[aria-label="Select Photo 1.png"]')!.click());
    assert.equal(dialog.querySelector('[aria-label="Select Photo 2.png"]')!.getAttribute("aria-disabled"), "true");
    assert.match(dialog.querySelector(".company-media-footer")!.textContent ?? "", /^1 selected/);
    await React.act(async () => dialog.querySelector('[aria-label="Search company media"]')!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.equal(Boolean(document.querySelector(".company-media-picker")), false);
    assert.equal(ui.closeRequests(), 0);
    await ui.submit();
    assert.equal(JSON.parse(String(ui.forms[0].get("mediaUrls"))).length, 19);
  } finally { await ui.close(); globalThis.fetch = previousFetch; }
});

test("uploading in the company picker selects the new file and adds it to the product on Done", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ items: [], total: 0 });
  const ui = await mount(true, {}, true);
  try {
    await ui.click("Add product media");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const dialog = document.querySelector<HTMLElement>(".company-media-picker")!;
    const input = dialog.querySelector<HTMLInputElement>('[aria-label="Upload company media"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["image"], "New spool.png", { type: "image/png" })] });
    await React.act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    assert.match(dialog.querySelector(".company-media-footer")!.textContent ?? "", /^1 selected/);
    assert.match(dialog.querySelector(".company-media-grid")!.textContent ?? "", /New spool.png/);
    assert.equal(ui.forms.length, 0);
    await React.act(async () => Array.from(dialog.querySelectorAll(".company-media-footer button")).find(button => button.textContent === "Done")!.click());
    await ui.submit();
    assert.deepEqual(JSON.parse(String(ui.forms[0].get("mediaUrls"))), ["https://example.com/cover.png", "https://example.com/second.png", "https://example.com/upload.png"]);
    assert.equal(ui.closeRequests(), 0);
  } finally { await ui.close(); globalThis.fetch = previousFetch; }
});

test("the product content card leads with Title, editable description and media, and saves those changes", async () => {
  const ui = await mount(true, { manualInventory: 23, diameter: "1.75 mm", weight: "1 kg", leadTime: "5 days" });
  try {
    const card = ui.host.querySelector('[aria-label="Product content"]')!;
    assert.ok(card.querySelector('#product-name'));
    assert.ok(card.querySelector('[role="textbox"][aria-label="Description"]'));
    assert.equal(ui.host.querySelector('[data-slot="card"]'), card);
    assert.equal(ui.host.querySelector('[aria-labelledby="product-details-heading"]'), null);
    assert.ok(card.querySelector('#product-sku'));
    assert.ok(card.querySelector('#product-material'));
    assert.equal(card.querySelectorAll(".product-media-item").length, 2);
    assert.match(ui.host.querySelector(".product-editor-heading #product-status")!.className, /bg-primary/);
    await ui.change(ui.host.querySelector<HTMLInputElement>('#product-name')!, "Winter Glow Bundle");
    assert.equal(ui.host.querySelector(".product-title-back .variant-workspace-back-name")?.textContent, "Winter Glow Bundle");
    const editor = card.querySelector<HTMLElement>('[aria-label="Description"][contenteditable]')!;
    await React.act(async () => { editor.innerHTML = "<h2>What's included</h2><ul><li>White — 1 kg</li></ul>"; editor.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    await ui.click("Use image 2 as cover");
    await ui.change(ui.host.querySelector<HTMLInputElement>('#product-material')!, "PLA silk");
    await ui.click("Product status");
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "Draft")!.click());
    assert.equal(ui.host.querySelector('#product-status [data-slot="select-value"]')?.textContent, "Draft");
    await ui.submit();
    assert.equal(ui.forms.length, 1);
    assert.equal(ui.forms[0].get("name"), "Winter Glow Bundle");
    assert.equal(ui.forms[0].get("manualInventory"), "23", "editing product content preserves existing inventory");
    assert.equal(ui.forms[0].get("material"), "PLA silk");
    assert.equal(ui.forms[0].get("active"), "false", "the status dropdown outside the form still saves the chosen status");
    assert.equal(ui.forms[0].get("diameter"), "1.75 mm");
    assert.equal(ui.forms[0].get("weight"), "1 kg");
    assert.equal(ui.forms[0].get("leadTime"), "5 days");
    assert.match(String(ui.forms[0].get("description")), /<ul><li>White — 1 kg<\/li><\/ul>/);
    assert.equal(ui.forms[0].get("imageUrl"), "https://example.com/second.png");
    assert.deepEqual(JSON.parse(String(ui.forms[0].get("mediaUrls"))), ["https://example.com/second.png", "https://example.com/cover.png"]);
    assert.equal(ui.saved.length, 1);
    const back = ui.host.querySelector<HTMLButtonElement>("[data-product-title-back]")!;
    assert.equal(back.getAttribute("aria-label"), "Back from Winter Glow Bundle");
    assert.equal(back.querySelector(".variant-workspace-back-action")?.textContent, "Back");
    await React.act(async () => back.click());
    assert.equal(ui.closeRequests(), 1);
    assert.equal(ui.forms.length, 1, "the title back button does not submit the product form");
  } finally { await ui.close(); }
});

test("compact volume pricing keeps ranges connected and saves the selected currency", async () => {
  const ui = await mount(true, { currency: "USD", priceTiers: [{ minimumQuantity: 1, price: "$6.41" }, { minimumQuantity: 100, price: "$6.04" }, { minimumQuantity: 500, price: "$5.78" }] });
  try {
    const pricing = ui.host.querySelector(".product-volume-pricing")!;
    assert.equal(pricing.querySelectorAll("tbody tr").length, 3);
    await ui.change(pricing.querySelector<HTMLInputElement>("#maximum-1")!, "149");
    assert.equal(pricing.querySelector<HTMLInputElement>("#minimum-2")!.value, "150");
    await ui.change(pricing.querySelector<HTMLInputElement>("#minimum-3")!, "600");
    assert.equal(pricing.querySelector<HTMLInputElement>("#maximum-2")!.value, "599");
    await ui.change(pricing.querySelector<HTMLInputElement>("#price-2")!, "5.95");
    await ui.click("Pricing currency");
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "EUR")!.click());
    assert.equal(ui.forms.length, 0);
    await ui.submit();
    assert.equal(ui.forms[0].get("currency"), "EUR");
    assert.equal(ui.forms[0].get("minimum2"), "150");
    assert.equal(ui.forms[0].get("minimum3"), "600");
    assert.equal(ui.forms[0].get("price2"), "5.95");
    const saved = ui.saved[0] as Product;
    assert.deepEqual(Array.from(saved.priceTiers, tier => [tier.minimumQuantity, tier.price]), [[1, "€6.41"], [150, "€5.95"], [600, "€5.78"]]);
  } finally { await ui.close(); }
});

test("volume pricing adds and removes ranges, validates missing prices, and accepts zero", async () => {
  const ui = await mount(true, { priceTiers: [{ minimumQuantity: 1, price: "$7.00" }] });
  try {
    const pricing = ui.host.querySelector(".product-volume-pricing")!;
    await ui.click("Add quantity range");
    assert.equal(pricing.querySelector<HTMLInputElement>("#minimum-2")!.value, "101");
    assert.equal(pricing.querySelector<HTMLInputElement>("#maximum-1")!.value, "100");
    await ui.submit();
    assert.equal(ui.forms.length, 0);
    assert.match(ui.host.textContent!, /Enter a valid unit price/);
    await ui.change(pricing.querySelector<HTMLInputElement>("#price-2")!, "0");
    await ui.click("Add quantity range");
    assert.equal(pricing.querySelectorAll("tbody tr").length, 3);
    assert.equal(pricing.querySelector('[aria-label="Add quantity range"]'), null);
    await ui.click("Remove quantity range");
    assert.equal(pricing.querySelectorAll("tbody tr").length, 2);
    assert.equal(pricing.querySelectorAll(".product-volume-unlimited").length, 1);
    await ui.submit();
    assert.equal(ui.forms.length, 1);
    assert.equal(ui.forms[0].get("price2"), "0");
    assert.equal(ui.forms[0].get("minimum3"), null);
  } finally { await ui.close(); }
});

test("HTML source changes are sanitized before saving, and formatting commands preserve the editor", async () => {
  const ui = await mount();
  try {
    await ui.click("Bold");
    assert.equal(ui.commands[0][0], "bold");
    await ui.click("Text style");
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "Heading")!.click());
    assert.ok(ui.commands.some(([command, argument]) => command === "formatBlock" && argument === "h2"));
    await ui.click("Edit HTML source");
    await ui.change(ui.host.querySelector<HTMLTextAreaElement>("textarea")!, '<p>Bundle <strong>details</strong></p><img src="x" onerror="bad()"><script>bad()</script>');
    await ui.click("Edit HTML source");
    assert.equal(ui.host.querySelector('[aria-label="Description"][contenteditable]')?.innerHTML, "<p>Bundle <strong>details</strong></p>");
    await ui.submit();
    assert.equal(ui.forms[0].get("description"), "<p>Bundle <strong>details</strong></p>");
  } finally { await ui.close(); }
});

test("media can be uploaded, promoted, removed and saved without changing unrelated fields", async () => {
  const ui = await mount();
  try {
    const input = ui.host.querySelector<HTMLInputElement>('[aria-label="Upload product images"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new dom.window.File(["image"], "photo.png", { type: "image/png" })] });
    await React.act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    assert.equal(ui.host.querySelectorAll(".product-media-item").length, 3);
    await ui.click("Remove product image 1");
    await ui.submit();
    assert.equal(ui.forms[0].get("imageUrl"), "https://example.com/second.png");
    assert.deepEqual(JSON.parse(String(ui.forms[0].get("mediaUrls"))), ["https://example.com/second.png", "https://example.com/upload.png"]);
    assert.equal(ui.forms[0].get("sku"), b2bProducts[0].sku);
    assert.equal(ui.forms[0].get("manualInventory"), "");
  } finally { await ui.close(); }
});

test("plain text paste preserves ampersands and angle brackets without double escaping", async () => {
  const ui = await mount();
  try {
    const editor = ui.host.querySelector('[aria-label="Description"][contenteditable]')!;
    const event = new dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (format: string) => format === "text/plain" ? "PLA & PETG < 3 kg" : "" } });
    await React.act(async () => editor.dispatchEvent(event));
    assert.match(editor.textContent ?? "", /PLA & PETG < 3 kg/);
    await ui.submit();
    assert.match(String(ui.forms[0].get("description")), /PLA &amp; PETG &lt; 3 kg/);
  } finally { await ui.close(); }
});

test("read-only product content cannot be edited or submitted", async () => {
  const ui = await mount(false);
  try {
    assert.equal(ui.host.querySelector('#product-name')?.hasAttribute("disabled"), true);
    assert.equal(ui.host.querySelector('#product-status')?.hasAttribute("disabled"), true);
    assert.equal(ui.host.querySelector('[aria-label="Description"]')?.getAttribute("contenteditable"), "false");
    assert.equal(ui.host.querySelector('[aria-label="Add product media"]'), null);
    assert.ok(Array.from(ui.host.querySelectorAll<HTMLInputElement>(".product-volume-pricing input[type=number]")).every(input => input.disabled));
    assert.equal(ui.host.querySelector('[aria-label="Pricing currency"]')?.hasAttribute("disabled"), true);
    assert.equal(ui.host.querySelector('[aria-label="Add quantity range"]'), null);
    await ui.submit();
    assert.equal(ui.forms.length, 0);
  } finally { await ui.close(); }
});

test("description links insert after their dialog closes without submitting the product form", async () => {
  const ui = await mount();
  try {
    await ui.click("Insert link");
    const popup = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!;
    assert.ok(popup);
    await ui.change(popup.querySelector<HTMLInputElement>("input")!, "https://example.com/details");
    await React.act(async () => Array.from(popup.querySelectorAll("button")).find(button => button.textContent === "Insert")!.click());
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(ui.forms.length, 0);
    assert.equal(ui.host.querySelector('[aria-label="Description"][contenteditable] a')?.getAttribute("href"), "https://example.com/details");
    await ui.submit();
    assert.match(String(ui.forms[0].get("description")), /href="https:\/\/example.com\/details"/);
  } finally { await ui.close(); }
});

test("filtered variant edits save the correct SKU, price and manual quantity", async () => {
  const variants = b2bProducts[0].variants.slice(0, 2);
  const ui = await mount(true, { variants });
  try {
    assert.equal(ui.host.querySelectorAll(".product-color-chip").length, 2);
    assert.equal(ui.host.querySelectorAll(".product-variants-table tbody tr").length, 2);
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Search variants"]')!, variants[1].sku);
    assert.equal(ui.host.querySelectorAll(".product-variants-table tbody tr").length, 1);
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Variant 2 price"]')!, "9.75");
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Variant 2 available quantity"]')!, "0");
    await ui.submit();
    const saved = JSON.parse(String(ui.forms[0].get("variants")));
    assert.equal(saved[0].sku, variants[0].sku);
    assert.equal(saved[0].price, variants[0].price);
    assert.equal(saved[1].sku, variants[1].sku);
    assert.equal(saved[1].price, "$9.75");
    assert.equal(saved[1].manualInventory, 0);
  } finally { await ui.close(); }
});

test("inventory dropdown filtering and partial checkbox selection keep the intended variants", async () => {
  const variants = b2bProducts[0].variants.slice(0, 2).map((variant, index) => index === 0 ? { ...variant, stock: { available: 407, onHand: 410, locked: 3, warehouseIds: ["1"], syncedAt: new Date().toISOString() } } : variant);
  const ui = await mount(true, { variants });
  try {
    await ui.click("Filter variant inventory");
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "Connected inventory")!.click());
    assert.equal(ui.host.querySelectorAll(".product-variants-table tbody tr").length, 1);
    assert.match(ui.host.querySelector(".product-variants-table tbody tr")!.textContent!, /407/);
    await ui.click("Filter variant inventory");
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "All inventory")!.click());
    await ui.click(`Select variant ${variants[1].name}`);
    assert.equal(ui.host.querySelector('[aria-label="Select visible variants"]')?.getAttribute("aria-checked"), "mixed");
    assert.equal(ui.forms.length, 0, "dropdown and selection actions must not submit the product");
    await React.act(async () => ui.host.querySelector<HTMLButtonElement>(".product-variant-selection button")!.click());
    await ui.submit();
    const saved = JSON.parse(String(ui.forms[0].get("variants")));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].sku, variants[0].sku);
  } finally { await ui.close(); }
});

test("unit pricing controls save their values and Escape closes only the nested dropdown", async () => {
  const variant = b2bProducts[0].variants[0];
  const ui = await mount(true, { variants: [variant] }, true);
  try {
    await ui.click(`Edit variant ${variant.name}`);
    await React.act(async () => ui.host.querySelector<HTMLLabelElement>('label[for="variant-unit-pricing"]')!.click());
    await ui.click("Unit");
    await React.act(async () => ui.host.querySelector('#variant-unit')!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.ok(ui.host.querySelector(".variant-workspace-inline"));
    assert.equal(ui.host.querySelector('#variant-unit')?.getAttribute("aria-expanded"), "false");
    await ui.click("Unit");
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "g")!.click());
    await ui.change(ui.host.querySelector<HTMLInputElement>("#variant-package-quantity")!, "500");
    await ui.change(ui.host.querySelector<HTMLInputElement>("#variant-reference-quantity")!, "100");
    await React.act(async () => Array.from(ui.host.querySelectorAll<HTMLButtonElement>(".variant-workspace-footer button")).find(button => button.textContent === "Apply changes")!.click());
    await ui.submit();
    assert.deepEqual(JSON.parse(String(ui.forms[0].get("variants")))[0].unitPricing, { quantity: 500, referenceQuantity: 100, unit: "g" });
    assert.equal(ui.closeRequests(), 0);
  } finally { await ui.close(); }
});

test("a variant can be added with a color swatch and existing product photo", async () => {
  const ui = await mount(true, { variants: b2bProducts[0].variants.slice(0, 2) });
  try {
    await React.act(async () => ui.host.querySelector<HTMLButtonElement>(".product-variants-heading button")!.click());
    const popup = ui.host.querySelector<HTMLElement>(".variant-workspace-inline")!;
    await ui.change(popup.querySelector<HTMLInputElement>("#variant-edit-name")!, "Silk Orange");
    await ui.change(popup.querySelector<HTMLInputElement>("#variant-edit-sku")!, "PLA-SILK-ORANGE");
    await ui.change(popup.querySelector<HTMLInputElement>("#variant-edit-swatch")!, "#ef8833");
    await ui.change(popup.querySelector<HTMLInputElement>("#variant-edit-quantity")!, "109");
    await React.act(async () => popup.querySelector<HTMLButtonElement>('[aria-label="Choose product image 2 for variant"]')!.click());
    await React.act(async () => Array.from(popup.querySelectorAll("button")).find(button => button.textContent === "Add variant")!.click());
    assert.equal(ui.host.querySelectorAll(".product-color-chip").length, 3);
    await ui.submit();
    const variants = JSON.parse(String(ui.forms[0].get("variants")));
    assert.equal(variants[2].name, "Silk Orange");
    assert.equal(variants[2].sku, "PLA-SILK-ORANGE");
    assert.equal(variants[2].manualInventory, 109);
    assert.equal(variants[2].colorHex, "#ef8833");
    assert.equal(variants[2].imageUrl, "https://example.com/second.png");
  } finally { await ui.close(); }
});

test("variant details use the existing product panel and preserve drafts when switching variants", async () => {
  const variants = b2bProducts[0].variants.slice(0, 2);
  const ui = await mount(true, { variants }, true);
  try {
    const dialogsBefore = document.querySelectorAll('[role="dialog"]').length;
    assert.equal(dialogsBefore, 1);
    const sheet = document.querySelector('[role="dialog"]');
    await ui.click(`Edit variant ${variants[0].name}`);
    assert.equal(document.querySelectorAll('[role="dialog"]').length, dialogsBefore);
    assert.equal(document.querySelector('[role="dialog"]'), sheet);
    assert.ok(ui.host.querySelector('[role="region"][aria-label="Variant settings"]'));
    const back = ui.host.querySelector<HTMLButtonElement>("[data-variant-back]")!;
    assert.equal(back.querySelector(".variant-workspace-back-name")?.textContent, variants[0].name);
    assert.equal(back.querySelector(".variant-workspace-back-action")?.textContent, "Back");
    assert.equal(back.getAttribute("aria-label"), `Back from ${variants[0].name}`);
    assert.equal(ui.host.querySelector(".variant-workspace-header h3, .variant-workspace-header p"), null);
    await ui.change(ui.host.querySelector<HTMLInputElement>("#variant-barcode")!, "0012345678905");
    await ui.change(ui.host.querySelector<HTMLInputElement>("#variant-cost")!, "2.50");
    await React.act(async () => ui.host.querySelectorAll<HTMLButtonElement>(".variant-workspace-sidebar nav button")[1].click());
    assert.equal(back.querySelector(".variant-workspace-back-name")?.textContent, variants[1].name);
    assert.equal(ui.host.querySelector<HTMLInputElement>("#variant-barcode")!.value, "");
    await ui.change(ui.host.querySelector<HTMLInputElement>("#variant-compare-price")!, "8.99");
    await React.act(async () => ui.host.querySelectorAll<HTMLButtonElement>(".variant-workspace-sidebar nav button")[0].click());
    assert.equal(ui.host.querySelector<HTMLInputElement>("#variant-barcode")!.value, "0012345678905");
    await React.act(async () => ui.host.querySelector<HTMLButtonElement>("[data-variant-back]")!.click());
    assert.equal(ui.host.querySelector(".variant-workspace-inline"), null);
    await ui.submit();
    const saved = JSON.parse(String(ui.forms[0].get("variants")));
    assert.equal(saved[0].barcode, "0012345678905");
    assert.equal(saved[0].costPerItem, "2.50");
    assert.equal(saved[1].compareAtPrice, "8.99");
  } finally { await ui.close(); }
});

test("Escape cancels variant edits without closing the product sheet or losing product fields", async () => {
  const variants = b2bProducts[0].variants.slice(0, 2);
  const ui = await mount(true, { variants }, true);
  try {
    await ui.change(ui.host.querySelector<HTMLInputElement>("#product-name")!, "Unsaved product title");
    await ui.click(`Edit variant ${variants[0].name}`);
    const input = ui.host.querySelector<HTMLInputElement>("#variant-barcode")!;
    await ui.change(input, "discard-me");
    await React.act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.equal(ui.host.querySelector(".variant-workspace-inline"), null);
    assert.equal(ui.closeRequests(), 0);
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
    assert.equal(ui.host.querySelector<HTMLInputElement>("#product-name")!.value, "Unsaved product title");
    await ui.submit();
    assert.equal(JSON.parse(String(ui.forms[0].get("variants")))[0].barcode, undefined);
  } finally { await ui.close(); }
});

test("custom options generate editable combinations in the same product form", async () => {
  const ui = await mount(true, { variants: b2bProducts[0].variants.slice(0, 2) });
  try {
    await ui.click("Add another option");
    await ui.change(document.querySelector<HTMLInputElement>('[aria-label="Search product options"]')!, "weight");
    assert.equal(Array.from(document.querySelectorAll('[data-slot="command-item"]')).some(item => item.textContent === "Material"), false);
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')).find(item => item.textContent === "Weight")!.click());
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Add another option value"]')!, "1 kg");
    await React.act(async () => ui.host.querySelector('[aria-label="Add another option value"]')!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Add another option value"]')!, "3 kg");
    await React.act(async () => Array.from(ui.host.querySelectorAll(".product-option-editor-actions button")).find(button => button.textContent === "Done")!.click());
    assert.equal(ui.host.querySelectorAll(".product-variants-table tbody tr").length, 4);
    await ui.submit();
    const variants = JSON.parse(String(ui.forms[0].get("variants")));
    assert.equal(variants[0].options[1].value, "1 kg");
    assert.equal(variants[1].options[1].value, "3 kg");
    assert.equal(variants[1].manualInventory, null);
  } finally { await ui.close(); }
});

test("option drafts validate individual values, block premature saving, and cancel without changing SKUs", async () => {
  const before = b2bProducts[0].variants.slice(0, 2);
  const ui = await mount(true, { variants: before }, true);
  try {
    await ui.click("Edit Color option");
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Option value 1"]')!, "Renamed color");
    await ui.submit();
    assert.equal(ui.forms.length, 0);
    assert.match(ui.host.textContent ?? "", /Choose Done or Cancel option/);
    await React.act(async () => ui.host.querySelector('[aria-label="Option value 1"]')!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.equal(ui.closeRequests(), 0, "Escape cancels just the option draft");
    await ui.click("Edit Color option");
    assert.equal(ui.host.querySelector<HTMLInputElement>('[aria-label="Option value 1"]')!.value, before[0].name);
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Option value 1"]')!, before[1].name);
    await React.act(async () => Array.from(ui.host.querySelectorAll(".product-option-editor-actions button")).find(button => button.textContent === "Done")!.click());
    assert.match(ui.host.querySelector(".product-option-editor")!.textContent ?? "", /Each option value must be different/);
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Option value 1"]')!, "Jet Black");
    await React.act(async () => Array.from(ui.host.querySelectorAll(".product-option-editor-actions button")).find(button => button.textContent === "Done")!.click());
    assert.equal(Boolean(ui.host.querySelector(".product-option-editor")), false);
    assert.equal(ui.forms.length, 0, "Done only applies to the unsaved product draft");
    await ui.submit();
    const saved = JSON.parse(String(ui.forms[0].get("variants")));
    assert.equal(saved[0].name, "Jet Black");
    assert.equal(saved[0].id, before[0].id);
    assert.equal(saved[0].sku, before[0].sku);
    assert.equal(saved[1].sku, before[1].sku);
  } finally { await ui.close(); }
});

test("grouped variants expand into the correct SKUs, keep filtered selection scoped, and save child prices", async () => {
  const before = variantTools.addVariantOption(b2bProducts[0].variants.slice(0, 2), "Weight", ["1 kg", "250 g"], b2bProducts[0].sku).map((variant, index) => ({ ...variant, price: String(10 + index), manualInventory: index === 3 ? null : 5 + index }));
  const color = before[0].options![0].value;
  const ui = await mount(true, { variants: before });
  try {
    const group = ui.host.querySelector(`[data-variant-group="${color}"]`)!;
    assert.match(group.textContent ?? "", /\$10\.00 – \$11\.00/);
    assert.match(group.textContent ?? "", /11/);
    assert.equal(ui.host.querySelectorAll('[data-variant-id]').length, 0);
    await ui.click(`Expand ${color} variants`);
    assert.equal(ui.host.querySelectorAll('[data-variant-id]').length, 2);
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Variant 2 price"]')!, "29.25");
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Search variants"]')!, before[1].sku);
    await ui.click(`Select Color ${color} variants`);
    assert.match(ui.host.querySelector(".product-variant-selection")!.textContent ?? "", /^1 selected/);
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Search variants"]')!, "");
    await ui.click("Group variants by");
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "Weight")!.click());
    assert.equal(ui.host.querySelectorAll('[data-variant-group]').length, 2);
    assert.match(ui.host.querySelector('[data-variant-group="250 g"]')!.textContent ?? "", /—/, "unknown stock is not presented as zero");
    await ui.click("Group variants by");
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "All variants")!.click());
    assert.equal(ui.host.querySelectorAll('[data-variant-id]').length, 4);
    await ui.submit();
    const saved = JSON.parse(String(ui.forms[0].get("variants")));
    assert.equal(saved[1].sku, before[1].sku);
    assert.equal(saved[1].price, "$29.25");
    assert.equal(saved[0].price, "$10.00");
  } finally { await ui.close(); }
});

test("deleting an option explicitly chooses which SKUs remain without merging inventory", async () => {
  const before = variantTools.addVariantOption(b2bProducts[0].variants.slice(0, 2), "Weight", ["1 kg", "250 g"], b2bProducts[0].sku).map((variant, index) => ({ ...variant, manualInventory: 10 + index }));
  const ui = await mount(true, { variants: before }, true);
  try {
    await ui.click("Edit Weight option");
    await React.act(async () => Array.from(ui.host.querySelectorAll(".product-option-editor-actions button")).find(button => button.textContent === "Delete")!.click());
    const dialog = document.querySelector('[data-slot="dialog-content"]')!;
    assert.match(dialog.textContent ?? "", /inventory is never merged/);
    await React.act(async () => dialog.querySelector<HTMLElement>('[aria-label="Option value to keep"]')!.click());
    await React.act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "250 g")!.click());
    await React.act(async () => Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Delete option")!.click());
    assert.equal(ui.closeRequests(), 0);
    assert.equal(Boolean(document.querySelector('[data-slot="dialog-content"]')), false);
    assert.equal(ui.host.querySelectorAll(".product-option-summary").length, 1);
    await ui.submit();
    const saved = JSON.parse(String(ui.forms[0].get("variants")));
    assert.deepEqual(saved.map((variant: { sku: string }) => variant.sku), [before[1].sku, before[3].sku]);
    assert.deepEqual(saved.map((variant: { manualInventory: number }) => variant.manualInventory), [11, 13]);
    assert.ok(saved.every((variant: { options: unknown[] }) => variant.options.length === 1));
  } finally { await ui.close(); }
});

test("team inventory updates save immediately and survive cancelling unrelated variant edits", async () => {
  const variant = { ...b2bProducts[0].variants[0], manualInventory: 5, sharedInventory: { locations: [{ location: "Main", quantity: 5, revision: "11111111-1111-4111-8111-111111111111", updated_at: "2026-11-18T10:00:00Z" }] } };
  const ui = await mount(true, { variants: [variant], sharedInventory: { locations: [] } }, true);
  try {
    await ui.click(`Edit variant ${variant.name}`);
    await ui.change(ui.host.querySelector<HTMLInputElement>("#variant-barcode")!, "discard-this");
    await ui.change(ui.host.querySelector<HTMLInputElement>('.variant-workspace-inline [id^="stock-quantity-"]')!, "0");
    await ui.change(ui.host.querySelector<HTMLInputElement>('.variant-workspace-inline [id^="stock-reason-"]')!, "Physical count");
    await React.act(async () => Array.from(ui.host.querySelectorAll(".variant-workspace-inline button")).find(button => button.textContent === "Update shared stock")!.click());
    assert.match(ui.host.querySelector(".variant-workspace-inline")?.textContent ?? "", /Stock updated for the team/);
    await React.act(async () => Array.from(ui.host.querySelectorAll(".variant-workspace-footer button")).find(button => button.textContent === "Cancel")!.click());
    assert.equal(ui.host.querySelector<HTMLButtonElement>(`[aria-label="Manage stock for ${variant.name}"]`)!.textContent, "0");
    await ui.submit();
    assert.equal(JSON.parse(String(ui.forms[0].get("variants")))[0].barcode, undefined);
  } finally { await ui.close(); }
});

test("connected variant inventory is read-only and selection removes only filtered rows", async () => {
  const variants = b2bProducts[0].variants.slice(0, 2).map((variant, index) => index === 0 ? { ...variant, stock: { available: 407, onHand: 410, locked: 3, warehouseIds: ["1"], syncedAt: new Date().toISOString() } } : variant);
  const ui = await mount(true, { variants });
  try {
    assert.equal(ui.host.querySelector('[aria-label="Variant 1 available quantity"]'), null);
    assert.match(ui.host.querySelector(".product-variants-table tbody tr")!.textContent ?? "", /407/);
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Search variants"]')!, variants[1].sku);
    await React.act(async () => ui.host.querySelector<HTMLInputElement>('[aria-label="Select visible variants"]')!.click());
    await React.act(async () => ui.host.querySelector<HTMLButtonElement>(".product-variant-selection button")!.click());
    await ui.change(ui.host.querySelector<HTMLInputElement>('[aria-label="Search variants"]')!, "");
    assert.equal(ui.host.querySelectorAll(".product-variants-table tbody tr").length, 1);
    assert.equal(ui.host.querySelector<HTMLButtonElement>(".product-variant-remove")!.disabled, true);
    await ui.submit();
    const saved = JSON.parse(String(ui.forms[0].get("variants")));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].sku, variants[0].sku);
  } finally { await ui.close(); }
});
