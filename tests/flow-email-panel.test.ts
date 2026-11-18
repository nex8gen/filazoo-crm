import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as flows from "../lib/flows.ts";
import * as emailEditor from "../lib/flow-email-editor.ts";
import * as editorSession from "../lib/flow-editor-session.ts";
import type { FlowPanelEditor } from "../lib/flow-editor-session.ts";

type Element = { type: string; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function harness(disabled = false, saved = false) {
  const config = saved ? { ...flows.defaultFlowInput.steps[1].config, emailName: "WELCOME10" } : { ...flows.blankStep("send_email").config };
  let cursor = 0, writes = 0, closes = 0, previews = 0;
  const state: unknown[] = [];
  const editorRef: { current: FlowPanelEditor | null } = { current: null };
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { lazy: () => "TemplatePage", Suspense: "Suspense", useId: () => "email", useEffect() {}, useImperativeHandle(ref: typeof editorRef, read: () => FlowPanelEditor) { ref.current = read(); }, useState(value: unknown) { const index = cursor++; if (!(index in state)) state[index] = typeof value === "function" ? value() : value; return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; } },
    "@/lib/flows": flows, "@/lib/flow-email-editor": emailEditor, "@/lib/flow-editor-session": editorSession,
    "@/lib/flow-email-utm": { flowUtmKeys: ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] },
    "@/components/flow-email-performance": { FlowEmailMetrics: "FlowEmailMetrics", FlowEmailStatus: "FlowEmailStatus", useEmailPerformance: () => ({ report: null, loading: false, refresh() {} }) },
  };
  const output: Record<string, (props: Record<string, unknown>) => Element> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/flow-email-panel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: output, structuredClone, require: (name: string) => dependencies[name] || components });
  const render = () => { cursor = 0; return output.FlowEmailPanel({ config, disabled, editorRef, saved, actionId: "email", sender: { name: "Filazoo", email: "sender@example.com" }, status: saved ? "live" : "draft", defaultName: "Email #1", sessionKey: "test", mailboxes: [], onChange: () => { writes++; }, onClose: () => { closes++; }, onPreview() { previews++; } }); };
  return { render, editorRef, get writes() { return writes; }, get closes() { return closes; }, get previews() { return previews; } };
}
function button(tree: Element, label: string) { return elements(tree).find(node => node.type === "Button" && node.props.children === label)!; }
function click(tree: Element, label: string) { (button(tree, label).props.onClick as () => void)(); }
function input(tree: Element, id: string, value: string) { (elements(tree).find(node => node.props.id === id)!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); }

test("Select template opens the template page and applies the chosen content only to the pending editor", () => {
  const app = harness();
  click(app.render(), "Select template");
  const page = elements(app.render()).find(node => node.type === "TemplatePage")!;
  assert.equal(page.props.mode, "library");
  (page.props.onApply as (config: flows.JsonConfig) => void)(emailEditor.applyFlowEmailTemplate(page.props.config as flows.JsonConfig, { id: "saved", name: "Welcome", subject: "Welcome aboard", body: "Hello {{first_name}}" }));
  app.render();
  assert.equal(app.writes, 0);
  assert.equal(app.editorRef.current!.hasChanges(), true);
  const result = app.editorRef.current!.prepare();
  assert.equal(result.ok && result.config?.sourceTemplateId, "saved");
  assert.equal(result.ok && result.config?.subject, "Welcome aboard");
  assert.equal(elements(app.render()).some(node => node.type === "TemplatePage"), false);
  assert.ok(button(app.render(), "Change template"));
});

test("the reference template menu opens distinct text and HTML editors", () => {
  for (const [label, mode] of [["Create text only email", "text"], ["Create custom HTML email", "html"]]) {
    const app = harness();
    const item = elements(app.render()).find(node => node.type === "DropdownMenuItem" && node.props.children === label)!;
    (item.props.onClick as () => void)();
    assert.equal(elements(app.render()).find(node => node.type === "TemplatePage")!.props.mode, mode);
    assert.equal(app.writes, 0);
  }
});

test("subject, preview and name edits survive template-page cancellation, and closing never writes", () => {
  const app = harness();
  input(app.render(), "email-name", "My email"); input(app.render(), "email-subject", "My subject"); input(app.render(), "email-preheader", "My preview");
  click(app.render(), "Select template");
  (elements(app.render()).find(node => node.type === "TemplatePage")!.props.onClose as () => void)();
  assert.equal(elements(app.render()).find(node => node.props.id === "email-subject")!.props.value, "My subject");
  (elements(app.render()).find(node => node.props["aria-label"] === "Close email details")!.props.onClick as () => void)();
  assert.equal(app.closes, 1); assert.equal(app.writes, 0);
  assert.equal(app.editorRef.current!.prepare().ok, false, "An email still needs template content");
});

test("new email defaults match the reference and view-only fields cannot be edited", () => {
  const app = harness(true), tree = app.render();
  const smart = elements(tree).find(node => node.props["aria-label"] === "Skip recently emailed profiles")!;
  assert.equal(smart.props.checked, true);
  assert.equal(elements(tree).find(node => node.props["aria-label"] === "Enable UTM tracking")!.props.checked, false);
  assert.equal(button(tree, "Select template").props.disabled, true);
  input(tree, "email-name", "Forbidden"); app.render();
  assert.equal(app.editorRef.current!.hasChanges(), false);
});

test("saved email settings show sender summaries and previews without duplicate reports", () => {
  const app = harness(false, true);
  const tree = app.render();
  assert.equal(elements(tree).some(node => node.type === "FlowEmailMetrics"), false);
  assert.equal(elements(tree).some(node => node.props.children === "View details"), false);
  assert.equal(elements(tree).some(node => node.type === "Dialog"), false);
  assert.ok(elements(tree).some(node => node.type === "dd" && node.props.children === "sender@example.com"));
  assert.equal(elements(tree).some(node => node.props.id === "email-subject"), false);
  assert.ok(elements(tree).some(node => node.props["aria-label"] === "Mobile preview"));
  click(tree, "Edit");
  input(app.render(), "email-subject", "Updated subject");
  app.render();
  const prepared = app.editorRef.current!.prepare();
  assert.equal(prepared.ok && prepared.config?.subject, "Updated subject");
  assert.equal(app.writes, 0);
});

test("saved email controls switch preview devices and reopen the template editor", () => {
  const app = harness(false, true);
  (elements(app.render()).find(node => node.props["aria-label"] === "Mobile preview")!.props.onClick as () => void)();
  assert.equal(elements(app.render()).find(node => node.props.device === "mobile")?.type, "TemplatePage");
  (elements(app.render()).find(node => node.props["aria-label"] === "Edit email template")!.props.onClick as () => void)();
  assert.ok(elements(app.render()).some(node => node.type === "TemplatePage" && node.props.mode === "current"));
});

test("sender, personalization, tracking, and filter controls prepare real saved configuration", () => {
  const app = harness(false, true);
  click(app.render(), "Edit"); click(app.render(), "Edit sender");
  (elements(app.render()).find(node => node.type === "FlowSenderField")!.props.onChange as (value: string) => void)("team-mailbox");
  const name = elements(app.render()).find(node => node.type === "DropdownMenuItem" && node.props.children === "First name")!;
  (name.props.onClick as () => void)();
  const custom = elements(app.render()).find(node => node.props["aria-label"] === "Use custom tracking parameters")!;
  (custom.props.onCheckedChange as (value: boolean) => void)(true);
  click(app.render(), "Add filter");
  (elements(app.render()).find(node => node.type === "FlowConditionEditor")!.props.onChange as (value: flows.JsonConfig) => void)({ field: "customer_replied", negate: true });
  app.render();
  const result = app.editorRef.current!.prepare();
  assert.ok(result.ok);
  assert.equal(result.config?.mailboxId, "team-mailbox");
  assert.match(String(result.config?.subject), /\{\{first_name\}\}/);
  assert.equal(result.config?.useCustomUtm, true);
  assert.equal((result.config?.utmParameters as flows.JsonConfig).utm_campaign, "WELCOME10");
  assert.deepEqual(JSON.parse(JSON.stringify(result.config?.filters)), { field: "customer_replied", negate: true });
  click(app.render(), "Remove filter"); app.render();
  const removed = app.editorRef.current!.prepare(); assert.equal(removed.ok && removed.config?.filters, undefined);
});

test("switching actions can retain an incomplete email through the editor snapshot without publishing it", () => {
  const app = harness();
  input(app.render(), "email-subject", "Work in progress");
  app.render();
  const snapshot = app.editorRef.current!.snapshot!();
  assert.equal(snapshot.config?.subject, "Work in progress");
  assert.equal(app.editorRef.current!.prepare().ok, false, "Incomplete email templates must not become live");
  assert.equal(app.writes, 0);
});

test("email status edits prepare only this email's configuration and respect read-only access", () => {
  const app = harness(false, true);
  const control = () => elements(app.render()).find(node => node.type === "FlowEmailStatus")!;
  assert.equal(control().props.status, "live");
  (control().props.onChange as (status: string) => void)("draft");
  assert.equal(control().props.status, "draft");
  const prepared = app.editorRef.current!.prepare();
  assert.ok(prepared.ok);
  assert.equal(prepared.config?.emailStatus, "draft");
  assert.equal(prepared.config?.status, undefined);
  assert.equal(app.writes, 0);
  const locked = harness(true, true);
  const lockedControl = elements(locked.render()).find(node => node.type === "FlowEmailStatus")!;
  assert.equal(lockedControl.props.disabled, true);
  (lockedControl.props.onChange as (status: string) => void)("draft");
  locked.render();
  assert.equal(locked.editorRef.current!.hasChanges(), false);
});
