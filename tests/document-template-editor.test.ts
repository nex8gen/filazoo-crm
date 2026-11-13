import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as htmlDocument from "../lib/email-html-document.ts";
import * as React from "react";
import { JSDOM } from "jsdom";
import * as designTools from "../lib/email-design.ts";
import * as editorState from "../lib/email-editor-state.ts";
import * as blockConfig from "../lib/email-block-config.ts";
import type { LibraryDocument } from "../lib/documents.ts";
import { builtinEmailTemplate, builtinEmailTemplates } from "../lib/builtin-email-templates.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Node", "Event", "MouseEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url), h = React.createElement, act = React.act;
type Props = Record<string, unknown> & { children?: React.ReactNode };
const shell = (tag: string) => ({ children, ...props }: Props) => h(tag, props, children);
const button = ({ children, render, ...props }: Props) => { delete props.variant; delete props.size; return React.isValidElement(render) ? React.cloneElement(render as React.ReactElement<Props>, props, children ?? (render as React.ReactElement<Props>).props.children) : h("button", { type: "button", ...props }, children); };
function compile(file: string, dependencies: Record<string, unknown>, globals = {}) {
  const exports: Record<string, React.ComponentType<Props>> = {};
  const source = ts.transpileModule(readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; })(name), window: dom.window, document, HTMLInputElement, HTMLTextAreaElement, crypto, AbortController, Error, ...globals });
  return exports;
}

async function mount(source?: LibraryDocument, fetcher: typeof fetch = async () => Response.json({ document: source }), initial?: Partial<LibraryDocument>) {
  const saved: Array<Record<string, unknown>> = [];
  let closed = 0, failure = "";
  const dependencies: Record<string, unknown> = {
    "@/lib/email-html-document": htmlDocument,
    react: React, "react/jsx-runtime": require("react/jsx-runtime"), "lucide-react": require("lucide-react"),
    "@/lib/email-design": designTools, "@/lib/email-editor-state": editorState, "@/lib/email-block-config": blockConfig,
    "@/lib/email-social": { emailSocialSettings: () => ({}) },
    "@/components/column-resize-handle": { ColumnResizeHandle: () => null },
    "@/components/email-editor-controls": { EditorColorControl: () => null, EditorNumberControl: () => null, EditorSelect: () => null },
    "@/components/email-social-editor": { EmailSocialEditor: () => null },
    "@/components/email-product-editor": { EmailProductEditor: () => null },
    "@/components/email-block-controls": { BlockSection: shell("section") },
    "@/components/email-split-editor": { EmailSplitEditor: () => null },
    "@/components/email-image-maker": { EmailImageMaker: () => null },
    "@/lib/email-image-client": { optimizeEmailImage: () => null },
    "@/lib/email-products": { resolveEmailProductFeeds: (design: designTools.EmailDesign) => design, inlinePrivateEmailImages: async (design: designTools.EmailDesign) => design },
    "@/components/email-block-style-editor": { EmailBlockStyleEditor: () => null, EmailBlockDisplayEditor: () => null, EmailBlockTypographyEditor: () => null },
    "@/components/ui/button": { Button: button }, "@/components/ui/input": { Input: shell("input") }, "@/components/ui/textarea": { Textarea: shell("textarea") },
    "@/components/ui/dropdown-menu": { DropdownMenu: shell("div"), DropdownMenuTrigger: button, DropdownMenuContent: shell("div"), DropdownMenuItem: button, DropdownMenuSeparator: shell("hr") },
    "@/components/ui/dialog": { Dialog: ({ open, children }: Props) => open ? children : null, DialogContent: shell("section"), DialogHeader: shell("header"), DialogTitle: shell("h2"), DialogDescription: shell("p"), DialogFooter: shell("footer") },
    "./email-design-editor.css": {},
  };
  const designer = compile("email-design-editor", dependencies);
  let designerProps: Props | undefined;
  dependencies["next/dynamic"] = { default: () => (props: Props) => { designerProps = props; return h(designer.EmailDesignEditor, props); } };
  dependencies["@/components/document-editor"] = { DocumentDetailsEditor: ({ onSave, onClose }: Props) => h("section", { "aria-label": "Template settings" }, h("button", { onClick: async () => { await (onSave as (value: Props) => Promise<void>)({ subject: "Updated subject", tags: ["pricing"], related_ids: ["attachment-id"] }); (onClose as () => void)(); } }, "Update settings")) };
  const api = compile("document-template-editor", dependencies, { fetch: fetcher });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(h(api.DocumentTemplateEditor, {
    editor: source ? { mode: "edit", document: source } : { mode: "template", initial }, folders: [], folderId: "folder-id", category: "everyday", onClose: () => closed++,
    onSave: async (value: Record<string, unknown>) => { saved.push(structuredClone(value)); if (failure) throw new Error(failure); return { ...value, updated_at: `version-${saved.length}` } as unknown as LibraryDocument; },
  })));
  return {
    host, saved, get closed() { return closed; }, get props() { assert.ok(designerProps); return designerProps; }, fail: (message: string) => { failure = message; },
    click: async (name: string) => { const node = [...host.querySelectorAll<HTMLButtonElement>("button")].findLast(item => (item.getAttribute("aria-label") || item.textContent)?.trim() === name); assert.ok(node, `Missing button ${name}`); await act(async () => node.click()); },
    unmount: async () => { await act(() => root.unmount()); host.remove(); },
  };
}

test("library creation opens the new designer and Save template persists the design before closing", async () => {
  const ui = await mount();
  try {
    assert.ok(ui.host.querySelector(".email-designer"));
    assert.doesNotMatch(ui.host.textContent!, /Create a text template|Template content/);
    await ui.click("Save template");
    assert.equal(ui.saved[0].action, "create"); assert.equal(ui.saved[0].folder_id, "folder-id");
    assert.deepEqual(ui.saved[0].email_design, ui.props.initial);
    assert.equal(ui.saved[0].body, designTools.emailDesignText(ui.props.initial as designTools.EmailDesign));
    assert.equal(ui.closed, 1);
  } finally { await ui.unmount(); }
});

test("customizing a prebuilt design creates a workspace copy in Custom emails", async () => {
  const design = designTools.newEmailDesign("Hello {{first_name}}", "text");
  const ui = await mount(undefined, undefined, { name: "Introduction (copy)", category: "promotion", subject: "Welcome", body: "Hello {{first_name}}", email_design: design });
  try {
    assert.deepEqual(ui.props.initial, design);
    await ui.click("Save template");
    assert.equal(ui.saved[0].action, "create"); assert.equal(ui.saved[0].category, "everyday");
    assert.equal(ui.saved[0].name, "Introduction (copy)"); assert.equal(ui.saved[0].subject, "Welcome");
    assert.deepEqual(ui.saved[0].email_design, design); assert.equal(ui.closed, 1);
  } finally { await ui.unmount(); }
});

test("a Colorlib copy opens as editable blocks and keeps the native design when saved", async () => {
  const original = builtinEmailTemplate(builtinEmailTemplates()[0].id)!;
  const ui = await mount(undefined, undefined, { name: original.name + " (copy)", subject: original.subject, body: original.body, email_design: original.email_design });
  try {
    assert.equal(ui.host.querySelector('iframe[title="Original email design"]'), null);
    assert.ok(ui.host.querySelectorAll('[data-block-id]').length > 10);
    assert.match(ui.host.textContent!, /Shared canvases/);
    await ui.click("Save template");
    assert.equal(ui.saved[0].action, "create"); assert.equal(ui.saved[0].category, "everyday");
    assert.deepEqual(ui.saved[0].email_design, original.email_design);
  } finally { await ui.unmount(); }
});

test("settings survive repeated saves and the second save updates the returned version", async () => {
  const ui = await mount();
  try {
    await ui.click("Template settings"); await ui.click("Update settings");
    await ui.click("Save as template");
    const id = ui.saved[0].id;
    assert.equal(ui.closed, 0); assert.equal(ui.saved[0].subject, "Updated subject");
    assert.deepEqual(ui.saved[0].tags, ["pricing"]); assert.deepEqual(ui.saved[0].related_ids, ["attachment-id"]);
    await ui.click("Save template");
    assert.equal(ui.saved[1].id, id); assert.equal(ui.saved[1].action, "update"); assert.equal(ui.saved[1].updated_at, "version-1");
    assert.equal(ui.closed, 1);
  } finally { await ui.unmount(); }
});

test("failed saves keep the designer open with the current draft and error", async () => {
  const ui = await mount();
  try {
    ui.fail("Template changed in another session."); await ui.click("Save template");
    assert.equal(ui.closed, 0); assert.match(ui.host.textContent!, /Template changed in another session/);
    assert.deepEqual(ui.saved[0].email_design, ui.props.initial);
  } finally { await ui.unmount(); }
});

test("saving as a new template creates a separate record and subsequent saves target that copy", async () => {
  const ui = await mount();
  try {
    await ui.click("Save as template"); await ui.click("Save as new template");
    assert.equal(ui.saved[1].action, "create"); assert.notEqual(ui.saved[1].id, ui.saved[0].id);
    await ui.click("Save template");
    assert.equal(ui.saved[2].action, "update"); assert.equal(ui.saved[2].id, ui.saved[1].id); assert.equal(ui.saved[2].updated_at, "version-2");
  } finally { await ui.unmount(); }
});

test("leaving after a successful save does not report unsaved changes", async () => {
  const ui = await mount();
  try {
    await ui.click("Save as template"); await ui.click("Back to templates");
    assert.equal(ui.closed, 1); assert.doesNotMatch(ui.host.textContent!, /Discard editor changes/);
  } finally { await ui.unmount(); }
});

const legacy = { id: "template-id", name: "Existing template", kind: "template", body: "Hello {{first_name}}, welcome back.", subject: "Welcome", category: "everyday", updated_at: "original-version", related_ids: [] } as unknown as LibraryDocument;
test("editing fetches the complete saved design instead of flattening the library row", async () => {
  const design = designTools.newEmailDesign("Designed content");
  const ui = await mount({ ...legacy, design_version: "1" }, async () => Response.json({ document: { ...legacy, email_design: design } }));
  try { assert.deepEqual(ui.props.initial, design); await ui.click("Save template"); assert.equal(ui.saved[0].id, legacy.id); assert.equal(ui.saved[0].action, "update"); }
  finally { await ui.unmount(); }
});
test("old text templates open as editable text blocks in the new designer", async () => {
  const ui = await mount(legacy);
  try { assert.equal((ui.props.initial as designTools.EmailDesign).blocks[0].text, legacy.body); }
  finally { await ui.unmount(); }
});
test("an unavailable saved design cannot be overwritten with a flattened template", async () => {
  const ui = await mount({ ...legacy, design_version: "1" }, async () => Response.json({ error: "Unable to load template." }, { status: 503 }));
  try { assert.equal(ui.host.querySelector(".email-designer"), null); assert.match(ui.host.textContent!, /Unable to load template/); assert.equal(ui.saved.length, 0); }
  finally { await ui.unmount(); }
});
