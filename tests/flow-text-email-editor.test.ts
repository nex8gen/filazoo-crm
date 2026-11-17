import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as editorModel from "../lib/flow-text-email.ts";
import * as designs from "../lib/email-design.ts";
import * as markup from "../lib/email-markup.ts";
import * as sessions from "../lib/flow-editor-session.ts";
import * as templates from "../lib/flow-templates.ts";
import * as translation from "../lib/email-translation-document.ts";
import { defaultFlowInput, type JsonConfig } from "../lib/flows.ts";

type Element = { type: string; props: Record<string, unknown> };
function elements(value: unknown): Element[] { if (Array.isArray(value)) return value.flatMap(elements); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Element; return [node, ...elements(node.props.children)]; }
function harness(disabled = false) {
  const values: unknown[] = []; let cursor = 0, closes = 0;
  const saves: JsonConfig[] = [], calls: unknown[][] = []; let failSave = false;
  const dom = new JSDOM("<!doctype html><body></body>");
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: dom.window.DOMParser });
  Object.defineProperty(globalThis, "NodeFilter", { configurable: true, value: dom.window.NodeFilter });
  const state = (value: unknown) => { const index = cursor++; if (!(index in values)) values[index] = typeof value === "function" ? value() : value; return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; };
  const components = new Proxy({}, { get: (_target, key) => String(key) });
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const deps: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx }, react: { useState: state, useRef: (value: unknown) => state({ current: value })[0], useEffect() {} },
    "@/lib/flow-text-email": editorModel, "@/lib/email-design": designs, "@/lib/email-markup": markup, "@/lib/flow-editor-session": sessions, "@/lib/flow-templates": templates, "@/lib/email-translation-document": translation,
    "@/lib/email-translation-client": { requestEmailTranslation: async (segments: string[]) => segments.map(value => `译：${value}`) },
  };
  const output: Record<string, (props: Record<string, unknown>) => Element> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/flow-text-email-editor.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: output, AbortController, URL, window: { requestAnimationFrame: (job: () => void) => job() }, DOMParser: dom.window.DOMParser, NodeFilter: dom.window.NodeFilter, require: (name: string) => deps[name] ?? components });
  const render = () => {
    cursor = 0;
    const tree = output.FlowTextEmailEditor({ config: defaultFlowInput.steps[1].config, name: "Email #2", createNew: true, disabled, onSave: async (value: JsonConfig) => { if (failSave) return false; saves.push(value); return true; }, onClose: () => closes++ });
    const ref = elements(tree).find(node => node.type === "EmailBodyEditor")!.props.ref as { current: unknown };
    ref.current = { format: (...args: unknown[]) => calls.push(args), insertText: (...args: unknown[]) => calls.push(["text", ...args]), selectedText: () => "Selected", insertLink: (...args: unknown[]) => calls.push(["link", ...args]), insertImage: (...args: unknown[]) => calls.push(["image", ...args]) };
    return tree;
  };
  return { render, saves, calls, fail(value: boolean) { failSave = value; }, get closes() { return closes; } };
}
function click(tree: Element, label: string) { (elements(tree).find(node => node.type === "Button" && node.props.children === label)!.props.onClick as () => void)(); }
test("text-only editor saves formatted content and preview settings, rather than a template layout", () => {
  const app = harness(); let tree = app.render();
  assert.ok(elements(tree).some(node => node.type === "DialogTitle" && node.props.children === "Message Content"));
  (elements(tree).find(node => node.type === "EmailBodyEditor")!.props.onChange as (text: string, html: string) => void)("Hello {{first_name}}", "<p><b>Hello {{first_name}}</b></p>");
  tree = app.render();
  (elements(tree).find(node => node.type === "Checkbox")!.props.onCheckedChange as (checked: boolean) => void)(true);
  click(app.render(), "Save");
  assert.equal(app.saves[0].contentMode, "text"); assert.equal(app.saves[0].hidePreviewText, true);
  assert.equal(app.saves[0].body, "Hello {{first_name}}"); assert.match(editorModel.flowTextEmailHtml(app.saves[0]), /<b>/);
});
test("formatting, personalization, and preview controls are wired to the message editor", () => {
  const app = harness(); let tree = app.render();
  (elements(tree).find(node => node.props["aria-label"] === "Bold")!.props.onClick as () => void)();
  (elements(tree).find(node => node.props["aria-label"] === "Insert first name")!.props.onClick as () => void)();
  assert.deepEqual(app.calls, [["bold"], ["text", "{{first_name}} "]]);
  click(tree, "Preview email"); tree = app.render();
  const preview = elements(tree).find(node => node.props.title === "Text only email preview")!;
  assert.match(String(preview.props.srcDoc), /Hi Alex/); assert.doesNotMatch(String(preview.props.srcDoc), /\{\{first_name\}\}/);
});
test("translation preserves first-name variables and text formatting", async () => {
  const app = harness();
  const item = elements(app.render()).find(node => node.type === "DropdownMenuItem" && node.props.children === "Translate to Simplified Chinese")!;
  (item.props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve));
  click(app.render(), "Save");
  assert.match(String(app.saves[0].body), /译/); assert.match(String(app.saves[0].body), /\{\{first_name\}\}/);
});
test("leaving changed content asks before discarding and read-only access disables Save", () => {
  const app = harness();
  (elements(app.render()).find(node => node.type === "EmailBodyEditor")!.props.onChange as (text: string, html: string) => void)("Changed", "<p>Changed</p>");
  click(app.render(), "Email #2");
  assert.ok(elements(app.render()).some(node => node.type === "Dialog" && node.props.open === true && elements(node).some(child => child.props.children === "Discard message changes?")));
  assert.equal(app.closes, 0);
  const readOnly = harness(true); assert.equal(elements(readOnly.render()).find(node => node.type === "Button" && node.props.children === "Save")!.props.disabled, true);
});

test("failed saves keep the message open and allow a retry without losing content", async () => {
  const app = harness(); app.fail(true);
  (elements(app.render()).find(node => node.type === "EmailBodyEditor")!.props.onChange as (text: string, html: string) => void)("Keep my edits", "<p>Keep my edits</p>");
  click(app.render(), "Save"); await new Promise(resolve => setImmediate(resolve));
  assert.ok(elements(app.render()).some(node => node.props.role === "alert" && String(node.props.children).includes("could not be saved")));
  assert.equal(elements(app.render()).find(node => node.type === "EmailBodyEditor")!.props.value, "Keep my edits");
  assert.equal(app.saves.length, 0);
  app.fail(false); click(app.render(), "Save"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.saves[0].body, "Keep my edits");
});

test("font size can be typed freely, and link insertion validates URLs before updating the message", () => {
  const app = harness();
  const size = () => elements(app.render()).find(node => node.props["aria-label"] === "Font size")!;
  (size().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "2" } });
  (size().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "24" } });
  (elements(app.render()).find(node => node.props["aria-label"] === "Insert link")!.props.onClick as () => void)();
  const urlInput = () => elements(app.render()).find(node => node.type === "Input" && node.props.placeholder === "https://")!;
  (urlInput().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "javascript:alert(1)" } });
  click(app.render(), "Insert"); assert.equal(app.calls.length, 0);
  (urlInput().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "https://example.com/catalog" } });
  click(app.render(), "Insert");
  assert.deepEqual(app.calls, [["link", "https://example.com/catalog", "Selected"]]);
  click(app.render(), "Save"); assert.equal(app.saves[0].textFontSize, 24);
});

test("text-only creation and editing bypass the visual template designer", () => {
  const components = new Proxy({}, { get: (_target, key) => String(key) });
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const exports: Record<string, (props: Record<string, unknown>) => Element> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/flow-email-template-page.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const dependencies: Record<string, unknown> = { "react/jsx-runtime": { jsx, jsxs: jsx }, react: { useState: (value: unknown) => [value, () => {}] }, "@/lib/flow-text-email": editorModel, "@/lib/flow-email-editor": { flowEmailContent: () => ({ subject: "Subject", body: "Body" }) } };
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? components });
  const base = { config: defaultFlowInput.steps[1].config, sessionKey: "text", disabled: false, onApply() {}, onClose() {} };
  const fresh = exports.FlowEmailTemplatePage({ ...base, mode: "text" });
  assert.equal(fresh.type, "FlowTextEmailEditor"); assert.equal(fresh.props.createNew, true);
  const existing = exports.FlowEmailTemplatePage({ ...base, mode: "current" });
  assert.equal(existing.type, "FlowTextEmailEditor"); assert.equal(existing.props.createNew, false);
  const html = exports.FlowEmailTemplatePage({ ...base, mode: "html" });
  assert.ok(elements(html).some(node => node.type === "CampaignTemplateLibrary" && node.props.initialEditor === "html"));
});
