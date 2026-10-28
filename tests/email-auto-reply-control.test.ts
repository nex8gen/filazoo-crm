import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";
import ts from "typescript";
import { requestAutoReply } from "../lib/email-auto-reply-client.ts";

test("a stalled status connection times out instead of permanently disabling the switch", async () => {
  const request: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  await assert.rejects(requestAutoReply("/status", {}, { request, timeoutMs: 5 }), /timed out.*Try again/);
});

test("server save failures remain visible instead of claiming the feature was enabled", async () => {
  const request: typeof fetch = async () => Response.json({ error: "Mailbox is stopped." }, { status: 409 });
  await assert.rejects(requestAutoReply("/save", { method: "POST" }, { request }), /Mailbox is stopped/);
});

type Element = { type: unknown; props: Record<string, unknown> };
function children(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(children);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...children(element.props.children)];
}

function control(initialVisibility = "visible") {
  const state: unknown[] = [], effects: Array<() => (() => void) | void> = [];
  const deps: unknown[][] = [];
  let cursor = 0, enabled = false;
  const calls: Array<{ method: string; input?: Record<string, unknown> }> = [];
  const row = () => ({ id: "saved", enabled, status: enabled ? "active" : "paused", revision: calls.length,
    recipient: "buyer@example.test", mailbox_id: "mailbox", thread_key: "thread", assigned_to: "user" });
  const request: typeof fetch = async (_input, init) => {
    const method = init?.method || "GET";
    const input = method === "POST" ? JSON.parse(String(init?.body)) : undefined;
    calls.push({ method, input });
    if (input) enabled = input.action === "enable";
    return Response.json({ ok: true, automation: calls.length > 1 ? row() : null });
  };
  const react = {
    useState: (initial: unknown) => { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef: (initial: unknown) => { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useEffect: (effect: () => (() => void) | void, next: unknown[]) => {
      const index = cursor++;
      if (!deps[index] || next.some((value, position) => value !== deps[index][position])) { effects.push(effect); deps[index] = next; }
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/link": { default: "link" }, "lucide-react": {}, "@/components/ui/button": { Button: "button" },
    "@/components/ui/dialog": {}, "@/lib/email-auto-reply": {}, "@/lib/invoices": {},
    "@/lib/email-auto-reply-client": { requestAutoReply: (url: string, init: RequestInit) => requestAutoReply(url, init, { request }) },
  };
  const exports = {} as { EmailAutoReplyControl: (props: unknown) => Element };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/email-auto-reply-control.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => dependencies[name], URLSearchParams, AbortController, Event,
    setInterval: () => 1, clearInterval: () => undefined,
    document: { visibilityState: initialVisibility, addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  });
  const render = () => { cursor = 0; return exports.EmailAutoReplyControl({ mailboxId: "mailbox", senderId: "mailbox", messageId: "<test@example.test>" }); };
  const flush = async () => { for (const effect of effects.splice(0)) effect(); await setImmediate(); };
  const toggle = (tree: Element) => children(tree).find((element) => element.props.role === "switch")!;
  return { render, flush, toggle, calls };
}

test("the compact switch can turn on and off, and persists both actions", async () => {
  const app = control();
  app.render(); await app.flush();
  let tree = app.render(), toggle = app.toggle(tree);
  assert.equal(toggle.props.disabled, false);
  assert.equal(toggle.props["aria-checked"], false);
  (toggle.props.onClick as () => void)(); await app.flush();
  tree = app.render(); toggle = app.toggle(tree);
  assert.equal(toggle.props["aria-checked"], true);
  assert.equal(app.calls.at(-1)?.input?.action, "enable");
  (toggle.props.onClick as () => void)(); await app.flush();
  toggle = app.toggle(app.render());
  assert.equal(toggle.props["aria-checked"], false);
  assert.equal(app.calls.at(-1)?.input?.action, "stop");
  assert.doesNotMatch(JSON.stringify(tree), /Checking this conversation|Enable only for replies|Only this conversation is monitored/);
});

test("opening AI tools in a background webview still loads the setting", async () => {
  const app = control("hidden");
  app.render(); await app.flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.toggle(app.render()).props.disabled, false);
});
