import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import ts from "typescript";
import { JSDOM } from "jsdom";
import type { MessengerInboxData } from "../lib/messenger.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "Node", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent"] as const)
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../", import.meta.url));
const componentCode = ts.transpileModule(readFileSync(new URL("../components/messenger-inbox.tsx", import.meta.url), "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function fixture(): MessengerInboxData {
  const now = Date.now();
  const incoming = (id: string, body: string, offset: number) => ({ id, direction: "inbound" as const, body, type: "text", status: "received" as const, createdAt: new Date(now - offset).toISOString() });
  const first = incoming("m-1", "Could you share pricing?", 60_000);
  const second = incoming("m-2", "Do you ship internationally?", 120_000);
  return {
    connection: { configured: false, pageId: null, pageName: null, graphApiVersion: "v24.0", callbackUrl: "", missing: [], error: null, facebookConfigured: false, whatsappConfigured: true, whatsappSender: "+123", whatsappSandbox: false, instagramConfigured: false, instagramAccountId: null, instagramName: null, webConfigured: false },
    threads: [
      { id: "thread-a", customerId: "+111", customer: "Alice", pageId: "sender", status: "New", unread: 1, lastMessage: first.body, updatedAt: first.createdAt, replyWindowEndsAt: new Date(now + 3_600_000).toISOString(), replyWindowOpen: true, messages: [first], channel: "whatsapp" },
      { id: "thread-b", customerId: "+222", customer: "Ben", pageId: "sender", status: "New", unread: 1, lastMessage: second.body, updatedAt: second.createdAt, replyWindowEndsAt: new Date(now + 3_600_000).toISOString(), replyWindowOpen: true, messages: [second], channel: "whatsapp" },
    ],
    leads: [], dataError: null, canReply: true, websiteError: null,
  };
}

async function mount(data = fixture(), wide = false) {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: wide, addEventListener() {}, removeEventListener() {} }) });
  const requests: Array<{ url: string; init: RequestInit; resolve: (value: Response) => void }> = [];
  const launches: Array<{ mode: string; prompt: string; submit: boolean }> = [];
  const moduleExports: Record<string, unknown> = {};
  const css = new Proxy({}, { get: (_target, key) => String(key) });
  const Container = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const Icon = () => React.createElement("span");
  const menuMocks = { DropdownMenu: Container, DropdownMenuTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement("button", props, children), DropdownMenuContent: () => null, DropdownMenuItem: Container, DropdownMenuLabel: Container, DropdownMenuSeparator: () => null };
  const modules = new Map<string, Record<string, unknown>>();
  function loadLocal(name: string): Record<string, unknown> {
    if (modules.has(name)) return modules.get(name)!;
    const file = resolve(repo, name.slice(2) + (name.startsWith("@/lib/") ? ".ts" : ".tsx"));
    const exports = {};
    modules.set(name, exports);
    const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(source, { exports, console, window, document, HTMLElement, require: (dependency: string) => dependency.startsWith("@/") ? loadLocal(dependency) : require(dependency) }, { filename: file });
    return exports;
  }
  vm.runInNewContext(componentCode, {
    exports: moduleExports, window, document, navigator, HTMLElement, Date, console, AbortController, crypto,
    fetch: (url: string, init: RequestInit) => new Promise<Response>((resolve) => requests.push({ url, init, resolve })),
    require(name: string) {
      if (name === "react") return React;
      if (name.endsWith(".module.css")) return { __esModule: true, default: css };
      if (name === "next/link") return { __esModule: true, default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) };
      if (name === "@/components/language-provider") return { useLanguage: () => ({ language: "en", t: (value: string) => value }) };
      if (name === "@/components/page-header") return { PageActions: Container, PageHeaderDetails: Container };
      if (name === "@/components/ai-icon") return { AiIcon: Icon };
      if (name === "@/components/ui/dropdown-menu") return menuMocks;
      if (name === "@/components/ui/notification-toast") return { NotificationToast: ({ children, tone }: { children: React.ReactNode; tone: string }) => React.createElement("div", { role: tone === "error" ? "alert" : "status" }, children) };
      if (name === "@/lib/ai/launch") return { launchWorkspaceAi: (detail: typeof launches[number]) => launches.push(detail) };
      if (name.startsWith("@/")) return loadLocal(name);
      return require(name);
    },
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const Component = moduleExports.MessengerInbox as React.ComponentType<{ data: MetaInboxData }>;
  await React.act(() => root.render(React.createElement(Component, { data })));
  const button = (label: string, scope: ParentNode = host) => {
    const match = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label);
    assert.ok(match, "Missing button: " + label);
    return match;
  };
  return {
    host, requests, launches, button,
    editor: () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!,
    async click(label: string, scope: ParentNode = host) {
      const match = button(label, scope); assert.equal(match.disabled, false, "Disabled button: " + label);
      await React.act(() => match.click());
    },
    async thread(name: string) {
      const match = [...host.querySelectorAll<HTMLButtonElement>("[data-messenger-thread]")].find((item) => item.querySelector("strong")?.textContent === name);
      assert.ok(match, "Missing conversation: " + name);
      await React.act(() => match.click());
    },
    async type(value: string) {
      const editor = host.querySelector<HTMLTextAreaElement>("textarea")!;
      assert.equal(editor.disabled, false);
      await React.act(() => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, value);
        editor.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    },
    async close() { await React.act(() => root.unmount()); host.remove(); },
  };
}

test("channels keep the requested order and WhatsApp status is independent of Meta setup", async () => {
  const ui = await mount();
  try {
    const nav = ui.host.querySelector('nav[aria-label="Messaging channels"]')!;
    assert.deepEqual([...nav.querySelectorAll("button")].map((item) => item.textContent?.replace(/\d+/g, "").trim()), ["All", "Website", "WhatsApp", "Facebook", "Instagram"]);
    assert.match(ui.host.textContent!, /1 channel connected/);
    assert.ok(ui.host.querySelector('[data-slot="input-group"]'));
    assert.ok(ui.host.querySelector('[data-slot="avatar"]'));
    assert.ok(ui.host.querySelector('[data-slot="button"]'));
    assert.equal(ui.host.querySelector('[aria-label="Customer details"]'), null);
    assert.doesNotMatch(ui.host.textContent!, /YOUR MESSAGING WORKSPACE|Every channel\.|Make every conversation count|Good conversations start here|Customer context, close/);
    assert.equal(ui.editor().disabled, false);
    assert.doesNotMatch(ui.host.textContent!, /Meta setup needed|AI auto-reply|wholesale pet beds/);
    await ui.click("Website", nav);
    assert.equal(ui.host.querySelector("textarea"), null);
    assert.match(ui.host.textContent!, /Portal settings/);
  } finally { await ui.close(); }
});

test("drafts stay with their conversation and opening an unread thread does not replace it", async () => {
  const ui = await mount();
  try {
    await ui.type("Alice draft");
    const filters = ui.host.querySelector('[aria-label="Filter conversations"]')!;
    await ui.click("Unread2", filters);
    await ui.thread("Ben");
    assert.equal(ui.editor().value, "");
    assert.equal(ui.host.querySelector('[aria-label="Conversation"] h3')?.textContent, "Ben");
    await ui.type("Ben draft");
    await ui.thread("Alice");
    assert.equal(ui.editor().value, "Alice draft");
    assert.equal(ui.host.querySelectorAll("[data-messenger-thread]").length, 0);
    assert.equal(ui.editor().value, "Alice draft");
    assert.equal(ui.host.querySelector('[aria-label="Conversation"] h3')?.textContent, "Alice");
  } finally { await ui.close(); }
});

test("sending targets the captured thread, prevents duplicate submissions, and preserves another draft", async () => {
  const ui = await mount();
  try {
    await ui.thread("Ben");
    await ui.type("Ben draft");
    await ui.thread("Alice");
    await ui.type("Reply for Alice");
    await React.act(() => {
      for (let index = 0; index < 2; index++) ui.editor().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.requests[0].url, "/api/meta/send");
    assert.deepEqual(JSON.parse(String(ui.requests[0].init.body)), { to: "+111", message: "Reply for Alice", channel: "whatsapp" });
    await ui.thread("Ben");
    await React.act(() => ui.requests[0].resolve(Response.json({ messageId: "sent-1", createdAt: new Date().toISOString() })));
    assert.equal(ui.editor().value, "Ben draft");
    assert.doesNotMatch(ui.host.querySelector(".messages")!.textContent!, /Reply for Alice/);
    await ui.thread("Alice");
    assert.equal(ui.editor().value, "");
    assert.match(ui.host.querySelector(".messages")!.textContent!, /Reply for Alice/);
  } finally { await ui.close(); }
});

test("failed sends retain the draft and show the actionable error", async () => {
  const ui = await mount();
  try {
    await ui.type("Please keep this draft");
    await ui.click("Send");
    await React.act(() => ui.requests[0].resolve(Response.json({ error: "Provider is temporarily unavailable." }, { status: 503 })));
    assert.equal(ui.editor().value, "Please keep this draft");
    assert.match(ui.host.querySelector('[role="alert"]')!.textContent!, /Provider is temporarily unavailable/);
    assert.equal(ui.button("Send").disabled, false);
  } finally { await ui.close(); }
});

test("expired reply windows disable sending even if the server supplied a stale open flag", async () => {
  const data = fixture();
  data.threads[0].replyWindowEndsAt = new Date(Date.now() - 60_000).toISOString();
  const ui = await mount(data);
  try {
    assert.equal(ui.editor().disabled, true);
    assert.equal(ui.button("Send").disabled, true);
    assert.match(ui.host.textContent!, /reply window has ended/);
    assert.equal(ui.requests.length, 0);
    await ui.click("Resolve");
    assert.match(ui.host.textContent!, /Conversation resolved/);
    await ui.click("Reopen", ui.host.querySelector("[data-reply-notice]")!);
    assert.equal(ui.editor().disabled, true);
  } finally { await ui.close(); }
});

test("IME composition never submits and AI hands off a reviewable draft without sending", async () => {
  const ui = await mount();
  try {
    await ui.type("Draft for review");
    await React.act(() => ui.editor().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })));
    assert.equal(ui.requests.length, 0);
    await ui.click("Draft with AI");
    assert.equal(ui.launches.length, 1);
    assert.equal(ui.launches[0].mode, "agent");
    assert.equal(ui.launches[0].submit, false);
    assert.match(ui.launches[0].prompt, /thread-a.*Improve my draft: Draft for review.*Do not send/);
    await React.act(() => window.dispatchEvent(new window.CustomEvent("filazoo:agent-action", { detail: { draftMessage: { conversationId: "thread-b", text: "Prepared for Ben" } } })));
    assert.equal(ui.editor().value, "Prepared for Ben");
    await ui.thread("Alice");
    assert.equal(ui.editor().value, "Draft for review");
    await React.act(() => window.dispatchEvent(new window.CustomEvent("filazoo:agent-action", { detail: { draftMessage: { conversationId: "thread-a", text: "Do not overwrite" } } })));
    assert.equal(ui.editor().value, "Draft for review");
  } finally { await ui.close(); }
});

test("contact details use real conversation context and restore keyboard focus when closed", async () => {
  const ui = await mount();
  try {
    await ui.click("Show customer details");
    assert.equal(document.activeElement, ui.button("Close customer details"));
    const details = ui.host.querySelector('[aria-label="Customer details"]')!;
    assert.match(details.textContent!, /Customer ID.*\+111/);
    assert.doesNotMatch(details.textContent!, /Oct 12, 2026|Added to B2B leads|AI summary/);
    await React.act(() => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(ui.host.querySelector('[aria-label="Customer details"]'), null);
    assert.equal(document.activeElement, ui.button("Show customer details"));
  } finally { await ui.close(); }
});


function websiteFixture() {
  const data = fixture();
  data.connection.whatsappConfigured = false;
  data.connection.webConfigured = true;
  const original = data.threads[0];
  data.threads = [{ ...original, id: "web:717cd1d4-0739-4f3f-bbba-a331c7422f31", channel: "web", unread: 0,
    invoiceId: "717cd1d4-0739-4f3f-bbba-a331c7422f31", companyId: "a37acc59-4a11-47db-ad1e-aa9fe5d72e74",
    contextLabel: "INV-000123", replyWindowOpen: false, replyWindowEndsAt: new Date(Date.now() - 86400_000).toISOString(),
  }];
  return data;
}

test("website replies use the portal endpoint, stay idempotent on retry, and have no social reply deadline", async () => {
  const data = websiteFixture();
  const ui = await mount(data);
  try {
    assert.equal(ui.editor().disabled, false);
    assert.equal(ui.editor().maxLength, 4000);
    assert.match(ui.host.textContent!, /INV-000123/);
    await ui.type("Your portal reply");
    await ui.click("Send");
    const first = JSON.parse(String(ui.requests[0].init.body));
    assert.equal(ui.requests[0].url, "/api/invoices/" + data.threads[0].invoiceId + "/portal?companyId=" + data.threads[0].companyId);
    assert.equal(first.action, "reply");
    assert.equal(first.body, "Your portal reply");
    assert.match(first.id, /^[a-f0-9-]{36}$/);
    await React.act(() => ui.requests[0].resolve(Response.json({ error: "Please retry." }, { status: 503 })));
    assert.equal(ui.editor().value, "Your portal reply");
    await ui.click("Send");
    assert.equal(JSON.parse(String(ui.requests[1].init.body)).id, first.id);
    await React.act(() => ui.requests[1].resolve(Response.json({ ok: true })));
    assert.equal(ui.editor().value, "");
    assert.match(ui.host.querySelector(".messages")!.textContent!, /Your portal reply/);
    assert.equal(ui.requests.some((request) => request.url === "/api/meta/send"), false);
  } finally { await ui.close(); }
});

test("website polling updates both conversation and unread state without replacing the draft", async () => {
  const data = websiteFixture();
  const ui = await mount(data);
  try {
    await ui.thread("Alice");
    await ui.type("Unsent staff draft");
    await React.act(() => window.dispatchEvent(new window.Event("focus")));
    assert.equal(ui.requests[0].url, "/api/messenger/website");
    const thread = data.threads[0];
    const incoming = { ...thread.messages[0], id: "new-customer-message", body: "I just sent this from my portal", createdAt: new Date().toISOString() };
    await React.act(() => ui.requests[0].resolve(Response.json({ connected: true, canReply: true, threads: [{ ...thread, messages: [...thread.messages, incoming], lastMessage: incoming.body, updatedAt: incoming.createdAt, unread: 1 }] })));
    assert.match(ui.host.querySelector(".messages")!.textContent!, /I just sent this from my portal/);
    assert.equal(ui.editor().value, "Unsent staff draft");
    assert.equal(ui.host.querySelector('[aria-label="1 unread messages"]'), null);
  } finally { await ui.close(); }
});

test("read-only staff cannot reply and revoked website access removes private conversation content", async () => {
  const data = websiteFixture(); data.canReply = false;
  const ui = await mount(data);
  try {
    assert.equal(ui.editor().disabled, true);
    assert.equal(ui.button("Send").disabled, true);
    assert.match(ui.host.textContent!, /read-only access/);
    await React.act(() => window.dispatchEvent(new window.Event("focus")));
    await React.act(() => ui.requests[0].resolve(Response.json({ error: "No longer authorized." }, { status: 403 })));
    assert.equal(ui.host.querySelector("textarea"), null);
    assert.doesNotMatch(ui.host.textContent!, /Could you share pricing/);
  } finally { await ui.close(); }
});

test("a redirected or incomplete website send response never clears the draft or invents a sent message", async () => {
  const ui = await mount(websiteFixture());
  try {
    await ui.type("Keep until confirmed");
    await ui.click("Send");
    await React.act(() => ui.requests[0].resolve(new Response("<html>Sign in</html>", { status: 200, headers: { "Content-Type": "text/html" } })));
    assert.equal(ui.editor().value, "Keep until confirmed");
    assert.doesNotMatch(ui.host.querySelector(".messages")!.textContent!, /Keep until confirmed/);
    assert.match(ui.host.querySelector('[role="alert"]')!.textContent!, /could not be sent/);
  } finally { await ui.close(); }
});
