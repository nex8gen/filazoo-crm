import assert from "node:assert/strict";
import test from "node:test";
import { createEmailPrebuilt, emailEditorCanSave, emailEditorHistory, emailPrebuiltLayouts, resizeEmailColumns } from "../lib/email-editor-state.ts";
import { duplicateEmailBlock, emailDesignSchema, emailDesignText, moveEmailBlock, newEmailBlock, newEmailDesign, removeEmailBlock, renderEmailDesign } from "../lib/email-design.ts";

test("text alternatives follow column reading order and retain HTML links and image descriptions", () => {
  const design = { ...newEmailDesign(), blocks: [] as ReturnType<typeof newEmailBlock>[] };
  const columns = newEmailBlock("columns"); design.blocks.push(columns, newEmailBlock("text", { parentId: columns.id, column: 1, text: "Right column" }), newEmailBlock("text", { parentId: columns.id, column: 0, text: "Left column" }), newEmailBlock("html", { html: '<p><a href="https://example.test/offer">View offer</a></p><img src="https://example.test/image.png" alt="Image description">' }));
  const text = emailDesignText(design);
  assert.ok(text.indexOf("Left column") < text.indexOf("Right column"));
  assert.match(text, /View offer \(https:\/\/example.test\/offer\)/); assert.match(text, /Image description/);
});

test("image-only HTML and media templates can save, while empty containers and unsafe-only markup cannot", () => {
  for (const block of [newEmailBlock("image", { src: "https://example.test/image.png" }), newEmailBlock("html", { html: '<img src="https://example.test/image.png">' }), newEmailBlock("social", { links: [{ label: "Website", href: "https://example.test" }] })]) assert.equal(emailEditorCanSave({ ...newEmailDesign(), blocks: [block] }), true);
  for (const block of [newEmailBlock("columns"), newEmailBlock("section"), newEmailBlock("spacer"), newEmailBlock("html", { html: "<script>unsafe()</script>" }), newEmailBlock("image", { src: "javascript:unsafe()" })]) assert.equal(emailEditorCanSave({ ...newEmailDesign(), blocks: [block] }), false);
});

test("all pre-built layouts retain selected fonts, colours and responsive columns", () => {
  const theme = { ...newEmailDesign().theme, fontFamily: "Georgia" as const, fontSize: 22, textColor: "#112233", background: "#aabbcc", accent: "#123456" };
  for (const layout of emailPrebuiltLayouts) {
    const design = createEmailPrebuilt(layout, theme); assert.ok(emailDesignSchema.safeParse(design).success); assert.deepEqual(design.theme, theme); assert.ok(design.blocks.every(block => block.fontFamily === "Georgia"));
    const html = renderEmailDesign(design).html; assert.match(html, /#aabbcc/); assert.match(html, /Georgia/); assert.ok(emailEditorCanSave(design));
    if (layout === "products") assert.match(html, /email-column/);
    if (layout === "welcome") assert.match(html, /background:#123456/);
  }
});

test("deep nested duplicate/delete/move retain whole subtrees and reject cycles and hidden root columns", () => {
  const base = { ...newEmailDesign(), blocks: [] as ReturnType<typeof newEmailBlock>[] };
  const section = newEmailBlock("section"), columns = newEmailBlock("columns", { parentId: section.id }), nested = newEmailBlock("section", { parentId: columns.id, column: 1 }), text = newEmailBlock("text", { parentId: nested.id, text: "Deep copy" });
  base.blocks.push(section, columns, nested, text); assert.ok(emailDesignSchema.safeParse(base).success);
  const copied = duplicateEmailBlock(base, section.id); assert.equal(copied.design.blocks.length, 8); assert.ok(emailDesignSchema.safeParse(copied.design).success); assert.equal(new Set(copied.design.blocks.map(block => block.id)).size, 8);
  assert.equal(removeEmailBlock(copied.design, section.id).blocks.length, 4);
  assert.equal(moveEmailBlock(base, section.id, nested.id, 0), base);
  assert.equal(moveEmailBlock(base, text.id, null, 2), base);
  assert.equal(emailDesignSchema.safeParse({ ...base, blocks: [newEmailBlock("text", { column: 1 })] }).success, false);
  const reduced = resizeEmailColumns({ ...base, blocks: base.blocks.map(block => block.id === columns.id ? { ...block, columnCount: 3 } : block.id === nested.id ? { ...block, column: 2 } : block) }, columns.id, 2);
  assert.equal(reduced.blocks.find(block => block.id === nested.id)!.column, 1); assert.equal(reduced.blocks.find(block => block.id === text.id)!.parentId, nested.id);
});

test("history is bounded, preserves redo ordering and clears redo on a new edit", () => {
  let state = { past: [] as ReturnType<typeof newEmailDesign>[], present: newEmailDesign("0", "text"), future: [] as ReturnType<typeof newEmailDesign>[] };
  for (let i = 1; i <= 60; i++) state = emailEditorHistory(state, { type: "change", design: { ...state.present, blocks: [{ ...state.present.blocks[0], text: String(i) }] } });
  assert.equal(state.past.length, 40);
  for (let i = 0; i < 50; i++) state = emailEditorHistory(state, { type: "undo" });
  assert.equal(state.present.blocks[0].text, "20"); assert.equal(state.future.length, 40);
  state = emailEditorHistory(state, { type: "redo" }); assert.equal(state.present.blocks[0].text, "21");
  state = emailEditorHistory(state, { type: "change", design: newEmailDesign("New branch", "text") }); assert.equal(state.future.length, 0);
});

test("schema enforces block, upload and nesting limits without mutating valid drafts", () => {
  const design = { ...newEmailDesign(), blocks: Array.from({ length: 200 }, () => newEmailBlock("text")) }; assert.ok(emailDesignSchema.safeParse(design).success);
  assert.equal(emailDesignSchema.safeParse(duplicateEmailBlock(design, design.blocks[0].id).design).success, false);
  const image = () => newEmailBlock("image", { src: "data:image/png;base64,AAAA" });
  assert.ok(emailDesignSchema.safeParse({ ...design, blocks: Array.from({ length: 8 }, image) }).success);
  assert.equal(emailDesignSchema.safeParse({ ...design, blocks: Array.from({ length: 9 }, image) }).success, false);
  const deep = { ...design, blocks: [newEmailBlock("section")] };
  for (let i = 0; i < 5; i++) deep.blocks.push(newEmailBlock("section", { parentId: deep.blocks.at(-1)!.id }));
  assert.equal(emailDesignSchema.safeParse(deep).success, false);
});

test("exported button styling, divider radius and background images match their controls safely", () => {
  const design = newEmailDesign(); design.theme.backgroundImage = "https://example.test/image.png?x=');color:red;(";
  const button = newEmailBlock("button", { href: "https://example.test", bold: false, underline: true, shadow: true, background: "transparent" }); design.blocks.push(button, newEmailBlock("divider", { radius: 6 }));
  const html = renderEmailDesign(design).html;
  assert.match(html, /text-decoration:underline;font-weight:inherit;box-shadow/); assert.match(html, /border-radius:6px/); assert.match(html, /background-image:url\('https:\/\/example.test\/image.png\?x=%27%29;color:red;%28'\)/);
  assert.doesNotMatch(html, /url\('https:\/\/example.test\/image.png\?x='\)/);
});
