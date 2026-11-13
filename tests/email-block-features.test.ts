import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import ts from "typescript";
import sharp from "sharp";
import { JSDOM } from "jsdom";
import { emailBlockName, emailDesignSchema, emailDesignText, emailDesignUrl, newEmailBlock, newEmailDesign, renderEmailDesign } from "../lib/email-design.ts";
import { blockInsets, blockPresentation, emailProductConfigSchema, insets, productButtonStyle, productTextStyle, setColumnWidth } from "../lib/email-block-config.ts";
import { emailProductIssues, inlinePrivateEmailImages, resolveEmailProductFeeds, selectEmailFeedProducts } from "../lib/email-products.ts";
import { privateProductImagePattern, PRODUCT_IMAGE_BUCKET } from "../lib/product-images.ts";
import { prepareComposerMessage } from "../lib/email-composer.ts";
import type { Product } from "../lib/types.ts";

const image = "https://example.test/photo.png";

test("block names retain their palette identity after styling, layout changes and saved-design reloads", () => {
  const blocks = [newEmailBlock("columns", { editorVariant: "split", columnCount: 3 }), newEmailBlock("columns", { editorVariant: "columns" }), newEmailBlock("section", { editorVariant: "drop-shadow", shadow: false }), newEmailBlock("section", { editorVariant: "section", shadow: true })];
  const saved = emailDesignSchema.parse(JSON.parse(JSON.stringify({ ...newEmailDesign(), blocks })));
  assert.deepEqual(saved.blocks.map(emailBlockName), ["Split", "Columns", "Drop shadow", "Section"]);
  assert.equal(emailBlockName(newEmailBlock("columns")), "Split");
  assert.equal(emailBlockName(newEmailBlock("section", { shadow: true })), "Drop shadow");
});
const owner = "11111111-1111-4111-8111-111111111111";
const privateImage = `/api/product-images/${owner}/22222222-2222-4222-8222-222222222222.png`;
const product = (sku: string, values: Partial<Product> = {}): Product => ({ sku, name: `Filament ${sku}`, imageUrl: image, material: "PLA", color: "White", colors: [], diameter: "1.75", weight: "1kg", price: "$20", moq: 1, priceTiers: [], stockStatus: "In stock", leadTime: "1 day", status: "Active", updatedAt: "2026-11-13T01:00:00Z", variants: [], ...values });
function withBlocks(...blocks: ReturnType<typeof newEmailBlock>[]) { return { ...newEmailDesign(), blocks }; }
function doc(html: string) { return new JSDOM(html).window.document; }

test("independent content and block padding, backgrounds and borders survive a saved JSON round trip", () => {
  const block = newEmailBlock("text", { text: "Styled text", background: "#f1f1f1", presentation: { padding: { top: 9, right: 18, bottom: 12, left: 24 }, areaPadding: insets(4), areaBackground: "#112233", border: { style: "dotted", width: 2, color: "#aabbcc" }, strike: true, letterSpacing: 2 } });
  const design = emailDesignSchema.parse(JSON.parse(JSON.stringify(withBlocks(block))));
  const document = doc(renderEmailDesign(design).html);
  const outer = document.querySelector(`.email-block-${block.id}>td`)!;
  assert.match(outer.getAttribute("style")!, /padding:9px 18px 12px 24px;background:#f1f1f1/);
  assert.match(outer.firstElementChild!.getAttribute("style")!, /padding:4px 4px 4px 4px;background:#112233;border:2px dotted #aabbcc/);
  assert.match(outer.getAttribute("style")!, /line-through;letter-spacing:2px/);
  assert.deepEqual(blockInsets(design.blocks[0], true), blockInsets(block));
  assert.equal(blockPresentation({ ...block, presentation: { padding: undefined } }).padding.top, 20);
});

test("image dimensions, aspect ratio, alignment, mobile fill and area border reach exported HTML and MIME preparation", () => {
  const block = newEmailBlock("image", { src: image, width: 320, align: "right", radius: 8, href: "https://example.test/item", presentation: { image: { height: 180, lockAspect: false, fillMobile: true }, border: { style: "solid", width: 2, color: "#ff0000" } } });
  const rendered = renderEmailDesign(withBlocks(block));
  const desktop = doc(rendered.html).querySelector("img")!;
  assert.equal(desktop.getAttribute("width"), "320"); assert.equal(desktop.getAttribute("height"), "180");
  assert.match(desktop.getAttribute("style")!, /width:320px.*height:180px.*border-radius:8px.*margin:0 0 0 auto/);
  assert.equal(desktop.closest("a")!.href, "https://example.test/item");
  assert.match(rendered.html, new RegExp(`email-image-${block.id}\\{width:100%!important`));
  const mobile = doc(renderEmailDesign(withBlocks(block), { viewport: "mobile" }).html).querySelector("img")!;
  assert.equal(mobile.getAttribute("width"), "100%");
  const message = prepareComposerMessage("Image", rendered.html, "");
  assert.match(message.html!, /width:320px/); assert.match(message.html!, /height:180px/);
  const auto = newEmailBlock("image", { src: image, presentation: { image: { autoWidth: true } } });
  assert.equal(doc(renderEmailDesign(withBlocks(auto)).html).querySelector("img")!.hasAttribute("width"), false);
});

test("buttons keep separate inner and outer backgrounds, full width, typography, border and shadow", () => {
  const block = newEmailBlock("button", { href: "https://example.test/shop", background: "#121212", shadow: true, presentation: { blockBackground: "#f1f1f1", button: { fullWidth: true, padding: { top: 16, right: 40, bottom: 16, left: 40 } }, border: { style: "double", width: 3, color: "#ff0000" }, shadowStrength: "large", shadowColor: "#123456", strike: true, letterSpacing: 1 } });
  const document = doc(renderEmailDesign(withBlocks(block)).html), anchor = document.querySelector("a")!;
  assert.match(anchor.getAttribute("style")!, /width:100%;padding:16px 40px 16px 40px;background:#121212/);
  assert.match(anchor.getAttribute("style")!, /border:3px double #ff0000/);
  assert.match(anchor.getAttribute("style")!, /box-shadow:0 6px 20px #12345640/);
  assert.match(anchor.getAttribute("style")!, /text-decoration:line-through/);
  assert.match(document.querySelector(`.email-block-${block.id}>td`)!.getAttribute("style")!, /background:#f1f1f1/);
});

test("split widths always total 100%, gap is exported, and mobile order and no-stacking are respected", () => {
  const split = newEmailBlock("columns", { presentation: { columns: { widths: [40, 60], gap: 36, stack: "right" } } });
  const design = withBlocks(split, newEmailBlock("text", { text: "LEFT-COLUMN", parentId: split.id }), newEmailBlock("text", { text: "RIGHT-COLUMN", parentId: split.id, column: 1 }));
  const desktop = renderEmailDesign(design).html;
  assert.match(desktop, /width="40%"/); assert.match(desktop, /padding-right:36px/);
  const mobile = renderEmailDesign(design, { viewport: "mobile" }).html;
  assert.ok(mobile.indexOf("RIGHT-COLUMN") < mobile.indexOf("LEFT-COLUMN"));
  assert.match(mobile, /width="100%"/);
  assert.deepEqual(setColumnWidth(split, 0, 25), [25, 75]);
  assert.equal(emailDesignSchema.safeParse({ ...design, blocks: [{ ...split, presentation: { columns: { widths: [90, 90] } } }] }).success, false);
  split.presentation.columns!.stack = "none";
  const unstacked = renderEmailDesign(design, { viewport: "mobile" }).html;
  assert.match(unstacked, /width="40%"/); assert.match(unstacked, /display:table-cell!important;width:40%!important/);
});

test("header desktop and mobile layouts use real logos, linked images and distinct navigation styling", () => {
  const block = newEmailBlock("header", { src: image, links: [{ label: "Shop", href: "https://example.test/shop" }, { label: "Our story", href: "https://example.test/about", customSrc: "https://example.test/about.png" }], presentation: { header: { layout: "reverse", mobileLayout: "logo-only", sameMobileLogo: false, mobileSrc: "https://example.test/mobile.png", mobileAlt: "Mobile logo", logoHref: "https://example.test", linkPadding: insets(7), linkColor: "#123456", linkSize: 18, horizontal: "manual", linkGap: 25, verticalAlign: "bottom" } } });
  const desktop = doc(renderEmailDesign(withBlocks(block)).html);
  assert.ok(desktop.querySelector(".email-header-nav")!.compareDocumentPosition(desktop.querySelector(".email-header-logo")!) & 4);
  assert.equal(desktop.querySelector(".email-header-logo")!.getAttribute("valign"), "bottom");
  assert.match(desktop.querySelector(".email-header-links td")!.getAttribute("style")!, /padding:7px 7px 7px 7px;color:#123456;font-size:18px.*padding-right:25px/);
  assert.equal(desktop.querySelectorAll(".email-header-links img").length, 1);
  const mobile = doc(renderEmailDesign(withBlocks(block), { viewport: "mobile" }).html);
  assert.equal(mobile.querySelector(".email-header-nav"), null);
  assert.equal(mobile.querySelector("img")!.src, "https://example.test/mobile.png");
  assert.equal(mobile.querySelector("img")!.alt, "Mobile logo");
  assert.equal(mobile.querySelector("img")!.closest("a")!.href, "https://example.test/");
});

test("divider, spacer, shadow and visibility settings produce actual email styles", () => {
  const divider = newEmailBlock("divider", { height: 3, color: "#abcdef", presentation: { lineStyle: "dashed" } });
  const spacer = newEmailBlock("spacer", { height: 60, background: "#ffeedd", presentation: { showDesktop: false, showMobile: true } });
  const shadow = newEmailBlock("section", { shadow: true, presentation: { shadowColor: "#123456", shadowStrength: "small", fullWidthMobile: true } });
  const html = renderEmailDesign(withBlocks(divider, spacer, shadow)).html;
  assert.match(html, /border-top:3px dashed #abcdef/); assert.match(html, /height:60px/);
  assert.match(html, /box-shadow:0 1px 4px #12345640/);
  const document = doc(html);
  assert.match(document.querySelector(`.email-block-${spacer.id}`)!.className, /email-social-hide-desktop/);
  assert.match(document.querySelector(`.email-block-${spacer.id}`)!.getAttribute("style")!, /display:none/);
  assert.match(html, /email-social-hide-desktop\{display:table-row!important/);
  assert.match(html, new RegExp(`email-block-${shadow.id}>td\\{padding-left:0!important`));
  const hidden = newEmailBlock("text", { text: "Hidden from both devices", presentation: { showDesktop: false, showMobile: false } });
  assert.equal(emailDesignText(withBlocks(hidden)), "");
});

test("catalog feeds filter and sort actual catalog data, honor start/rows, and encode product URLs", () => {
  const block = newEmailBlock("product", { product: emailProductConfigSchema.parse({ mode: "dynamic", perRow: 1, rows: 2, start: 1, feed: { name: "PLA in stock", material: "PLA", search: "Filament", availableOnly: true, sort: "price-low", linkTemplate: "https://shop.test/products/{sku}" } }) });
  const products = [product("a", { price: "$10" }), product("b/c", { price: "$20" }), product("c", { price: "$30" }), product("d", { price: "$5", status: "Inactive" }), product("e", { material: "ABS" }), product("f", { stockStatus: "Out of stock" })];
  const cards = selectEmailFeedProducts(block, products);
  assert.deepEqual(cards.map(card => card.sku), ["b/c", "c"]);
  assert.equal(cards[0].href, "https://shop.test/products/b%2Fc");
  assert.equal(cards[0].rating, null); assert.equal(cards[0].originalPrice, "");
  const refreshed = resolveEmailProductFeeds(withBlocks(block), products);
  assert.equal(refreshed.blocks[0].product!.cards.length, 2);
  assert.equal(block.product!.cards.length, 0, "feed resolution must not mutate a saved design");
  assert.deepEqual(emailProductIssues(refreshed), []);
});

test("static product details, independent text styles and button styles are preserved in preview and plain text", () => {
  const block = newEmailBlock("product");
  const nameStyle = { ...productTextStyle(block, "name"), color: "#112233", fontSize: 22, strike: true, letterSpacing: 2 };
  const button = { ...productButtonStyle(block), background: "#334455", border: { style: "solid" as const, width: 2, color: "#556677" }, padding: insets(14), shadow: true };
  block.product = emailProductConfigSchema.parse({ cards: [{ sku: "PLA", name: "Real product", imageUrl: image, price: "$19", originalPrice: "$29", description: "Real description", href: "https://shop.test/item", rating: 4.5 }], showOriginalPrice: true, showDescription: true, showRating: true, linkName: true, layout: "image-right", nameStyle, priceStyle: { ...productTextStyle(block, "price"), color: "#445566" }, button, buttonText: "Buy this", border: { style: "dotted", width: 1, color: "#778899" } });
  const design = emailDesignSchema.parse(JSON.parse(JSON.stringify(withBlocks(block))));
  const rendered = renderEmailDesign(design), document = doc(rendered.html);
  assert.equal(document.querySelector("s")!.textContent, "$29"); assert.match(rendered.html, /Rating 4.5 out of 5/);
  assert.match(rendered.html, /font-size:22px;color:#112233/); assert.match(rendered.html, /text-decoration:line-through;letter-spacing:2px/);
  assert.match(rendered.html, /color:#445566/); assert.match(rendered.html, /background:#334455;border:2px solid #556677/);
  assert.match(rendered.html, /border:1px dotted #778899/); assert.match(rendered.html, />Buy this<\/a>/);
  assert.match(emailDesignText(design), /Real product/); assert.match(rendered.text, /Real description/);
  assert.match(rendered.text, /https:\/\/shop.test\/item/);
  assert.deepEqual(emailProductIssues(design), []);
  block.product!.cards[0].href = "javascript:alert(1)";
  assert.match(emailProductIssues(withBlocks(block))[0], /public product link/);
  assert.match(emailProductIssues(withBlocks(newEmailBlock("product", { product: emailProductConfigSchema.parse({}) })))[0], /Choose products/);
});

test("private catalog images are preview-only until embedded and repeated references load once", async () => {
  assert.equal(emailDesignUrl(privateImage, true), ""); assert.equal(emailDesignUrl(privateImage, true, true), privateImage);
  const block = newEmailBlock("header", { src: privateImage, presentation: { header: { mobileSrc: privateImage } } });
  let loads = 0;
  const converted = await inlinePrivateEmailImages(withBlocks(block), async src => { loads++; assert.equal(src, privateImage); return "data:image/png;base64,AAAA"; });
  assert.equal(loads, 1); assert.equal(converted.blocks[0].src, "data:image/png;base64,AAAA");
  assert.equal(converted.blocks[0].presentation.header!.mobileSrc, converted.blocks[0].src);
  assert.equal(block.src, privateImage);
  assert.doesNotMatch(renderEmailDesign(withBlocks(block)).html, /src="\/api\/product-images/);
  assert.match(renderEmailDesign(withBlocks(block), { preview: true }).html, /src="\/api\/product-images/);
});

function imageServer(input: Buffer) {
  let downloads = 0;
  const dependencies: Record<string, unknown> = { "server-only": {}, "node:fs/promises": { readFile: async () => input }, "node:path": path, sharp, "../product-images.ts": { privateProductImagePattern, PRODUCT_IMAGE_BUCKET }, "../email-products.ts": { inlinePrivateEmailImages }, "../supabase/admin.ts": { createSupabaseAdmin: () => ({ storage: { from: (bucket: string) => { assert.equal(bucket, PRODUCT_IMAGE_BUCKET); return { download: async (key: string) => { downloads++; assert.equal(key, `${owner}/22222222-2222-4222-8222-222222222222.png`); return { data: new Blob([input]), error: null }; } }; } } }) } };
  const api = {} as { embedPrivateProductImages: (design: ReturnType<typeof newEmailDesign>, owner: string) => Promise<ReturnType<typeof newEmailDesign>> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-product-images.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports: api, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, process, Buffer, Error });
  return { api, downloads: () => downloads };
}

test("private product image embedding checks ownership before storage access and produces a bounded PNG", async () => {
  const input = await sharp({ create: { width: 800, height: 400, channels: 4, background: "#ff000080" } }).png().toBuffer();
  const server = imageServer(input), design = withBlocks(newEmailBlock("image", { src: privateImage }));
  await assert.rejects(server.api.embedPrivateProductImages(design, "other-user"), /own account/); assert.equal(server.downloads(), 0);
  const converted = await server.api.embedPrivateProductImages(design, owner);
  assert.equal(server.downloads(), 1);
  const bytes = Buffer.from(converted.blocks[0].src.split(",")[1], "base64"), meta = await sharp(bytes).metadata();
  assert.equal(meta.width, 600); assert.equal(meta.height, 300); assert.equal(meta.format, "png"); assert.equal(meta.hasAlpha, true);
  const message = prepareComposerMessage("Product", renderEmailDesign(converted).html, "");
  assert.equal(message.attachments.length, 1); assert.match(message.html!, /src="cid:/);
  assert.deepEqual(Buffer.from(message.attachments[0].content, "base64"), bytes);
});
