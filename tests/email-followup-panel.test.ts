import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";
import ts from "typescript";
import * as rules from "../lib/email-followup.ts";
import * as dates from "../lib/company-followup.ts";
import { followupConversationFilters, indexFollowupActions, updateFollowupActions, type FollowupActionRecord } from "../lib/email-followup-filters.ts";

type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element;
  return [node, ...elements(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return typeof value === "string" ? value : "";
}
function panel(options: { delayStatus?: boolean; saved?: Record<string, unknown>; failSave?: boolean } = {}) {
  const values: unknown[] = [], effects: Array<() => unknown> = [], deps: unknown[][] = [];
  let cursor = 0;
  let saved: Record<string, unknown> | null = options.saved || null;
  let statusReads = 0;
  let releaseStatus: (() => void) | undefined;
  const calls: Array<Record<string, unknown>> = [];
  let actions: FollowupActionRecord[] = [];
  const react = {
    useState(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect: () => unknown, next: unknown[]) { const index = cursor++; if (!deps[index] || next.some((value, position) => value !== deps[index][position])) { deps[index] = next; effects.push(effect); } },
    useEffectEvent(callback: unknown) { return callback; },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/link": { default: "link" }, "lucide-react": {},
    "@/components/ui/button": { Button: "button" }, "@/components/ui/date-picker": { DatePicker: "date-picker" },
    "@/components/ui/dialog": { Dialog: "dialog", DialogContent: "dialog-content", DialogTitle: "dialog-title", DialogHeader: "dialog-header", DialogDescription: "dialog-description" },
    "@/components/ui/popover": { Popover: "popover", PopoverContent: "popover-content", PopoverTitle: "popover-title", PopoverTrigger: "popover-trigger" },
    "@/lib/company-followup": dates, "@/lib/email-followup": rules,
  };
  const exports = {} as { EmailFollowupPanel: (props: unknown) => Element };
  const sandbox = {
    exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    URLSearchParams, AbortController, AbortSignal, Event, Date, Error, crypto,
    setInterval: () => 1, clearInterval() {},
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    fetch: async (_url: string, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body));
      if (input.action === "status") {
        statusReads++;
        if (options.delayStatus) await new Promise<void>(resolve => { releaseStatus = resolve; });
        return Response.json({ followup: saved });
      }
      calls.push(input);
      if (input.action === "preview") return Response.json({ subject: "Re: Quote", body: "Do you have any questions about the quote?", baseline: ["crm-inquiry"] });
      if (input.action === "save" && options.failSave) return Response.json({ error: "The reminder could not be saved." }, { status: 409 });
      saved = input.action === "cancel" ? { ...saved, status: "cancelled", revision: input.revision + 1 }
        : { id: input.id, kind: input.kind, purpose: input.purpose, due_at: input.dueAt, subject: input.subject, body: input.body, status: "scheduled", revision: input.revision + 1 };
      return Response.json({ followup: saved });
    },
  };
  const requestExports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/email-followup-request.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { ...sandbox, exports: requestExports });
  dependencies["@/lib/email-followup-request"] = requestExports;
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/email-followup-panel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  const identity = rules.followupTarget([{ id: "crm-inquiry", messageId: null, direction: "inbound", mailboxId: null }], { id: "crm-inquiry", messageId: null, direction: "inbound", mailboxId: null }, "team-mailbox");
  const messages = [{ id: "crm-inquiry", messageId: null, threadId: "local:crm-inquiry" }];
  const render = () => { cursor = 0; return exports.EmailFollowupPanel({ ...identity, subject: "Quote", recipient: "buyer@example.test", aiConfigured: true, canManage: true, onUpdated(followup: rules.EmailFollowup | null, mutation?: string) {
    if (mutation && followup) actions = updateFollowupActions(actions, followup, messages);
  } }); };
  const flush = async () => { for (const effect of effects.splice(0)) effect(); await setImmediate(); };
  const button = (tree: Element, label: string) => { const result = elements(tree).find(node => node.type === "button" && text(node).startsWith(label)); assert.ok(result, label); return result; };
  return { render, flush, button, calls, filters: () => [...followupConversationFilters(messages, indexFollowupActions(actions))], reads: () => statusReads, releaseStatus: () => releaseStatus?.() };
}
test("dialogs open immediately during a slow status read, then save the actual existing revision", async () => {
  const app = panel({ delayStatus: true, saved: { id: "existing-followup", revision: 7, kind: "reminder", status: "scheduled", due_at: new Date(Date.now() + 3600_000).toISOString() } });
  let tree = app.render();
  assert.equal(Boolean(app.button(tree, "Remind me").props.disabled), false);
  assert.equal(Boolean(app.button(tree, "AI follow-up").props.disabled), false);
  (app.button(tree, "Remind me").props.onClick as () => void)(); await app.flush(); tree = app.render();
  assert.equal(elements(tree).find(node => node.type === "dialog")?.props.open, true);
  assert.equal(Boolean(app.button(tree, "Save reminder").props.disabled), true);
  assert.equal(app.reads(), 1, "Opening a dialog must not abort or restart its status read");
  app.releaseStatus(); await app.flush(); tree = app.render();
  assert.equal(Boolean(app.button(tree, "Save reminder").props.disabled), false);
  (app.button(tree, "Save reminder").props.onClick as () => void)(); await app.flush();
  assert.equal(app.calls.at(-1)?.id, "existing-followup"); assert.equal(app.calls.at(-1)?.revision, 7);
});
test("AI generation during the first status read cannot leave saving stuck in loading", async () => {
  const app = panel({ delayStatus: true }); let tree = app.render();
  (app.button(tree, "AI follow-up").props.onClick as () => void)(); await app.flush(); tree = app.render();
  assert.equal(app.reads(), 1);
  app.releaseStatus(); await app.flush(); tree = app.render();
  assert.equal(Boolean(app.button(tree, "Confirm follow-up").props.disabled), false);
});
test("a CRM message without an RFC ID enables Remind me and supports save and cancellation", async () => {
  const app = panel(); app.render(); await app.flush();
  assert.deepEqual(app.filters(), []);
  let tree = app.render(); const remind = app.button(tree, "Remind me");
  assert.equal(Boolean(remind.props.disabled), false);
  (remind.props.onClick as () => void)(); tree = app.render();
  assert.equal(elements(tree).find(node => node.type === "dialog")?.props.open, true);
  assert.deepEqual(app.filters(), [], "Opening the reminder dialog does not enroll the conversation");
  (app.button(tree, "Save reminder").props.onClick as () => void)(); await app.flush(); tree = app.render();
  assert.equal(app.calls.at(-1)?.messageId, "crm-inquiry");
  assert.equal(app.calls.at(-1)?.kind, "reminder");
  assert.deepEqual(app.filters(), ["manual"]);
  (app.button(tree, "Cancel").props.onClick as () => void)(); await app.flush();
  assert.equal(app.calls.at(-1)?.action, "cancel");
  assert.deepEqual(app.filters(), ["completed"]);
});
test("a CRM message without an RFC ID enables AI follow-up, loads its draft, and confirms scheduling", async () => {
  const app = panel(); app.render(); await app.flush();
  let tree = app.render(); const ai = app.button(tree, "AI follow-up");
  assert.equal(Boolean(ai.props.disabled), false);
  (ai.props.onClick as () => void)(); await app.flush(); tree = app.render();
  const editor = elements(tree).find(node => node.type === "textarea");
  assert.match(String(editor?.props.value), /questions about the quote/);
  assert.deepEqual(app.filters(), [], "Generating a preview does not start AI follow-up");
  const confirm = app.button(tree, "Confirm follow-up"); assert.equal(Boolean(confirm.props.disabled), false);
  (confirm.props.onClick as () => void)(); await app.flush();
  assert.equal(app.calls.at(-1)?.messageId, "crm-inquiry"); assert.equal(app.calls.at(-1)?.kind, "ai");
  assert.deepEqual(app.calls.at(-1)?.baseline, ["crm-inquiry"]);
  assert.deepEqual(app.filters(), ["ai"]);
});
test("dormant nurture is off by default and requires an explicit selection before confirming", async () => {
  const app = panel(); app.render(); await app.flush();
  let tree = app.render(); (app.button(tree, "AI follow-up").props.onClick as () => void)(); await app.flush(); tree = app.render();
  const checkbox = elements(tree).find(node => node.type === "input" && node.props.type === "checkbox");
  assert.ok(checkbox); assert.equal(checkbox.props.checked, false);
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } }); tree = app.render();
  (app.button(tree, "Confirm follow-up").props.onClick as () => void)(); await app.flush();
  assert.equal(app.calls.at(-1)?.purpose, "nurture");
  assert.deepEqual(app.filters(), ["nurture"]);
});

test("a failed reminder save does not enroll the conversation in a follow-up tab", async () => {
  const app = panel({ failSave: true }); app.render(); await app.flush();
  let tree = app.render(); (app.button(tree, "Remind me").props.onClick as () => void)(); tree = app.render();
  (app.button(tree, "Save reminder").props.onClick as () => void)(); await app.flush(); tree = app.render();
  assert.deepEqual(app.filters(), []);
  assert.match(text(tree), /reminder could not be saved/);
  assert.equal(elements(tree).find(node => node.type === "dialog")?.props.open, true);
});
