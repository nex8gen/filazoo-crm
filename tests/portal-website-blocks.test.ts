import assert from "node:assert/strict";
import test from "node:test";
import { defaultPortalDesign, portalDesignSchema, portalWebsiteBlockSchema } from "../lib/portal-design.ts";
import { createWebsiteSection, portalWebsiteDesign, publicWebsiteDesign, websiteSectionTypes } from "../lib/portal-website-design.ts";
import { changeWebsiteBlock, changeWebsiteSiblings, countWebsiteBlocks, createWebsiteBlock, duplicateWebsiteBlock, safeWebsiteLink, websiteBlockAt, websiteBlockPath, websiteSectionBlocks } from "../lib/portal-website-blocks.ts";

function fixture() {
  const design = defaultPortalDesign();
  const website = portalWebsiteDesign(design);
  const context = { brandName: design.brandName, supportEmail: "team@example.com", pages: website.pages, pageId: "home" };
  return { design, website, context };
}
test("all 16 section presets produce valid, uniquely identified editable elements", () => {
  assert.equal(websiteSectionTypes.length, 16);
  const { design, website, context } = fixture();
  for (const template of websiteSectionTypes) {
    const section = createWebsiteSection(template.value, `section-${template.value}`);
    section.blocks = websiteSectionBlocks(section, context);
    assert.ok(section.blocks.length > 0, template.label);
    assert.ok(countWebsiteBlocks(section.blocks) <= 60);
    const next = { ...design, website: { ...website, pages: website.pages.map(page => page.id === "home" ? { ...page, sections: [section] } : page) } };
    const parsed = portalDesignSchema.safeParse(next);
    assert.equal(parsed.success, true, `${template.label}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
  }
});
test("nested edits, reorder, duplication and removal preserve sibling content and original snapshots", () => {
  const { context } = fixture();
  const section = createWebsiteSection("columns", "columns");
  const original = websiteSectionBlocks(section, context);
  const before = JSON.stringify(original);
  const changed = changeWebsiteBlock(original, [2, 0, 0], element => ({ ...element, text: "A new heading", style: { fontSize: 30, color: "#123456" } }));
  assert.equal(websiteBlockAt(changed, [2, 0, 0])?.text, "A new heading");
  assert.equal(websiteBlockAt(changed, [2, 1, 0])?.text, "Column 2");
  assert.equal(JSON.stringify(original), before);
  const copy = duplicateWebsiteBlock(websiteBlockAt(changed, [2, 0])!);
  const duplicated = changeWebsiteSiblings(changed, [2], items => [...items, copy]);
  assert.deepEqual(websiteBlockPath(duplicated, copy.id), [2, 3]);
  assert.notEqual(copy.children![0].id, websiteBlockAt(changed, [2, 0, 0])?.id);
  const moved = changeWebsiteSiblings(duplicated, [2], items => [items[3], ...items.slice(0, 3)]);
  assert.deepEqual(websiteBlockPath(moved, copy.id), [2, 0]);
  const removed = changeWebsiteBlock(moved, [2, 0], () => null);
  assert.equal(websiteBlockPath(removed, copy.id), undefined);
  assert.equal(JSON.stringify(original), before);
});
test("hidden containers and bound legacy values are redacted before publishing", () => {
  const { design, website, context } = fixture();
  const section = createWebsiteSection("columns", "private");
  section.blocks = websiteSectionBlocks(section, context);
  section.title = "Hidden primary heading";
  section.body = "Hidden legacy paragraph";
  section.buttonLabel = "Hidden legacy button";
  section.blocks[0] = { ...section.blocks[0], enabled: false, text: "Hidden primary heading" };
  section.blocks[2].children![0].enabled = false;
  section.blocks[2].children![0].children![0].text = "Hidden nested secret";
  section.blocks[2].children![1].style = { desktopVisible: false, mobileVisible: false };
  section.blocks[2].children![1].children![0].text = "Hidden on both devices";
  const payload = publicWebsiteDesign({ ...design, website: { ...website, pages: [{ ...website.pages[0], sections: [section] }] } });
  const text = JSON.stringify(payload);
  for (const secret of ["Hidden primary heading", "Hidden legacy paragraph", "Hidden legacy button", "Hidden nested secret", "Hidden on both devices"]) assert.equal(text.includes(secret), false, secret);
  assert.ok(text.includes("Column 3"));
});
test("element links, nesting, IDs, colors and limits are validated before saving", () => {
  const base = createWebsiteBlock("button", "button");
  for (const link of ["account", "home", "pages/contact", "https://example.com/quote", "mailto:sales@example.com", "tel:+123456789", "#contact"]) {
    assert.equal(portalWebsiteBlockSchema.safeParse({ ...base, link }).success, true, link);
    assert.ok(safeWebsiteLink(link));
  }
  for (const link of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "//example.com", "https://user:password@example.com", "mailto:bad address"]) {
    assert.equal(portalWebsiteBlockSchema.safeParse({ ...base, link }).success, false, link);
    assert.equal(safeWebsiteLink(link), undefined);
  }
  const { design, website } = fixture();
  const section = createWebsiteSection("text", "text");
  const parse = (blocks: typeof section.blocks) => portalDesignSchema.safeParse({ ...design, website: { ...website, pages: [{ ...website.pages[0], sections: [{ ...section, blocks }] }] } });
  assert.equal(parse([base, base]).success, false);
  assert.equal(parse([{ ...base, style: { color: "red;display:none" } }]).success, false);
  assert.equal(parse([{ ...base, children: [createWebsiteBlock("text", "child")] }]).success, false);
  assert.equal(parse(Array.from({ length: 61 }, (_, index) => createWebsiteBlock("text", `element-${index}`))).success, false);
});
