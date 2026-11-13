import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseDocument, DomUtils } from "htmlparser2";
import sources from "../lib/colorlib-email-templates.json" with { type: "json" };
import { builtinEmailTemplates, builtinEmailTemplate } from "../lib/builtin-email-templates.ts";
import { emailDesignSchema, emailDesignUrl, renderEmailDesign, newEmailDesign, newEmailBlock, moveEmailBlock, duplicateEmailBlock, removeEmailBlock } from "../lib/email-design.ts";
import { emailEditorHistory } from "../lib/email-editor-state.ts";
import { sanitizeFullEmailHtml } from "../lib/email-html-document.ts";
import { documentInputSchema } from "../lib/documents.ts";

const root = new URL("../public/email-template-assets/colorlib/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("sources.json", root), "utf8")) as { files: Array<{ path: string; bytes: number; sha256: string }> };

test("every bundled original HTML and image is byte-identical to the pinned upstream file", () => {
  assert.equal(sources.length, 16); assert.equal(manifest.files.length, 107);
  for (const source of manifest.files) {
    const bytes = readFileSync(new URL(source.path, root));
    assert.equal(bytes.length, source.bytes, source.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.path);
  }
});

test("catalog shows attributed native designs and matching editor previews", () => {
  const catalog = builtinEmailTemplates(); assert.equal(catalog.length, 16);
  assert.deepEqual(catalog.map(item => item.name), sources.map(item => item.name));
  for (const item of catalog) {
    assert.equal(item.company, "Colorlib"); assert.equal(item.email_design, undefined);
    assert.match(item.preview_url!, /^\/email-template-assets\/colorlib\/\d+\/editor.html$/);
    assert.ok(existsSync(new URL("." + item.preview_url, new URL("../public/", import.meta.url))));
    const complete = builtinEmailTemplate(item.id)!;
    assert.ok(emailDesignSchema.safeParse(complete.email_design).success);
    assert.ok(complete.email_design!.blocks.length > 10);
    assert.ok(complete.email_design!.blocks.every(block => block.type !== "html"));
    assert.equal(complete.design_version, "2");
    assert.ok(documentInputSchema.safeParse({ ...complete, id: crypto.randomUUID() }).success);
  }
});

function elements(html: string, name: string) { return DomUtils.findAll(node => node.name === name, parseDocument(html).children); }
test("full previews preserve source CSS, original layout and copy with working bundled images", () => {
  for (const source of sources) {
    const original = readFileSync(new URL(`${source.sourceId}/index.html`, root), "utf8");
    const design = newEmailDesign(source.html, "html");
    const html = renderEmailDesign(design, { preview: true }).html;
    for (const name of ["table", "tr", "td", "img"]) assert.equal(elements(html, name).length, elements(original, name).length, `${source.name}: ${name}`);
    assert.deepEqual(elements(html, "style").map(node => DomUtils.textContent(node).trim()), elements(original, "style").map(node => DomUtils.textContent(node).trim()));
    assert.equal(DomUtils.textContent(parseDocument(html)).replace(/\s+/g, " "), DomUtils.textContent(parseDocument(original)).replace(/\s+/g, " "), source.name);
    for (const image of elements(html, "img")) {
      assert.ok(image.attribs.src, source.name);
      if (image.attribs.src.startsWith("/email-template-assets/")) assert.ok(existsSync(new URL("." + image.attribs.src, new URL("../public/", import.meta.url))), image.attribs.src);
    }
    assert.doesNotMatch(html, /email-block-|spool-blue|YOUR BRAND|FORM \/ STUDIO/);
    const sent = renderEmailDesign(design).html;
    assert.doesNotMatch(sent, /(?:src|background)="\/email-template-assets\//);
    if (source.html.includes("/email-template-assets/")) assert.match(sent, /https:\/\/raw\.githubusercontent\.com\/ColorlibHQ\/email-templates\//);
  }
});

test("native conversions retain visible copy, artwork, layouts and working delivery images", () => {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s·]/g, "");
  for (const source of sources) {
    const template = builtinEmailTemplate(source.id)!;
    const design = template.email_design!;
    const preview = renderEmailDesign(design, { preview: true }).html;
    const rendered = normalize(DomUtils.textContent(parseDocument(preview)));
    const original = parseDocument(source.html);
    const cells = DomUtils.findAll(node => node.name === "td" && /word-break:break-word/.test(node.attribs.style || ""), original.children);
    for (const cell of cells) {
      // Inline components may gain spacing and paragraphs when adapted to blocks.
      // Require every visible word in each source cell to survive conversion.
      const words = DomUtils.textContent(cell).trim().split(/\s+/).filter(Boolean);
      for (const word of words) assert.ok(rendered.includes(normalize(word)), `${source.name}: missing ${word}`);
    }
    for (const image of elements(source.html, "img")) assert.ok(preview.includes(image.attribs.src), `${source.name}: missing ${image.attribs.src}`);
    assert.equal(readFileSync(new URL("." + template.preview_url!, new URL("../public/", import.meta.url)), "utf8"), preview);
    const delivery = renderEmailDesign(design).html;
    assert.doesNotMatch(delivery, /(?:src|background)="\/email-template-assets\//);
    assert.doesNotMatch(delivery, /url\(['"]?\/email-template-assets\//);
    assert.match(renderEmailDesign(design, { viewport: "mobile" }).html, /email-content/);
    assert.ok(design.blocks.some(block => block.type === "columns" || block.type === "section"));
  }
});

test("every converted design supports independent edits, insertion, moving, undo and a saved round trip", () => {
  for (const source of sources) {
    const original = builtinEmailTemplate(source.id)!.email_design!;
    const design = structuredClone(original);
    const text = design.blocks.find(block => block.type === "text")!;
    text.text = "Edited in the visual editor";
    const button = newEmailBlock("button", { text: "Custom action", href: "https://example.test/action" });
    design.blocks.push(button);
    const moved = moveEmailBlock(design, button.id, null, 0, design.blocks[0].id);
    assert.equal(moved.blocks[0].id, button.id);
    const copied = duplicateEmailBlock(moved, text.id);
    const restored = removeEmailBlock(copied.design, copied.id);
    const saved = emailDesignSchema.parse(JSON.parse(JSON.stringify(restored)));
    assert.equal(saved.blocks.find(block => block.id === text.id)!.text, text.text);
    const history = emailEditorHistory({ past: [], present: original, future: [] }, { type: "change", design: saved });
    assert.deepEqual(emailEditorHistory(history, { type: "undo" }).present, original);
    assert.deepEqual(emailEditorHistory(emailEditorHistory(history, { type: "undo" }), { type: "redo" }).present, saved);
    assert.match(renderEmailDesign(saved).html, /Edited in the visual editor/);
    assert.notEqual(builtinEmailTemplate(source.id)!.email_design!.blocks.find(block => block.id === text.id)!.text, text.text);
  }
});

test("full document sanitization removes active content while retaining responsive email styling", () => {
  const source = `<html><head><style>@media(max-width:600px){.card{width:100%!important}}</style><script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://bad.test"></head><body onload="alert(1)"><table class="card" cellpadding="0" style="padding:48px;background:#e4e4e4"><tr><td><a href="javascript:alert(1)">Text</a><img src="javascript:alert(1)" onerror="alert(1)"></td></tr></table><iframe src="https://bad.test"></iframe></body></html>`;
  const html = sanitizeFullEmailHtml(source, { imageUrl: value => emailDesignUrl(value, true), link: value => emailDesignUrl(value) });
  assert.doesNotMatch(html, /<script|<iframe|onload|onerror|javascript:|http-equiv="refresh"/);
  assert.match(html, /@media\(max-width:600px\)/); assert.match(html, /cellpadding="0"/); assert.match(html, /padding:48px;background:#e4e4e4/);
  const design = newEmailDesign(source, "html");
  assert.doesNotMatch(renderEmailDesign(design).html, /<script|onload|javascript:/);
  assert.equal(emailDesignUrl("/email-template-assets/colorlib/25/images/../../secret.jpg", true, true), "");
  assert.equal(emailDesignUrl("/email-template-assets/colorlib/99/images/hero.jpg", true, true), "");
});
