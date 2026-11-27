import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { emailPageRequestSchema } from "../lib/email-pagination.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent"] as const)
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
for (const key of ["requestAnimationFrame", "cancelAnimationFrame"] as const)
  Object.defineProperty(globalThis, key, { value: dom.window[key].bind(dom.window) });
Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false, addListener() {}, removeListener() {} }) });
dom.window.HTMLElement.prototype.scrollTo = () => {};
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../", import.meta.url));
type Props = Record<string, unknown> & { children?: React.ReactNode };
const Empty = () => null;
const Container = ({ children }: Props) => React.createElement(React.Fragment, {}, children);

async function mount(paginated = false, canSync = false) {
  let backgroundRefresh: () => Promise<void> = async () => {};
  const requests: Array<{ url: string; init?: RequestInit; resolve: (response: Response) => void }> = [];
  const cache = new Map<string, unknown>();
  const drafts = { ready: true, drafts: {}, put() {}, remove() {}, retry() {}, status: "Draft saved" };
  const preferences = { emailTranslate: false, emailAiSuggestions: false, emailMarkRead: false, emailSyncSeconds: 0, emailSignature: "" };
  const customerContext = { entries: {} };
  const componentMocks: Record<string, unknown> = {
    "@/components/preferences-provider": { usePreferences: () => ({ preferences }) },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (text: string) => text }) },
    "@/components/use-mail-drafts": { useMailDrafts: () => drafts },
    "@/components/use-email-footer": { useEmailFooter: () => ({ footer: null, loading: false, error: null }) },
    "@/components/use-email-customer-context": { useEmailCustomerContext: () => customerContext },
    "@/components/use-background-refresh": { useBackgroundRefresh(refresh: () => Promise<void>) { backgroundRefresh = refresh; } },
    "@/components/use-email-reply-link": { useEmailReplyLink() {} },
    "@/components/customer-tag-select": { CustomerTagSelect: ({ onChange }: { onChange: (tag: string) => void }) => React.createElement("button", { onClick: () => onChange("customer") }, "Set customer tag") },
    "@/components/email-body-editor": {
      useEmailEditorValue() {
        const [value, setValue] = React.useState({ text: "", html: "", bodyText: "" });
        const setText = React.useCallback((text: string) => setValue({ text, html: "", bodyText: text }), []);
        const onChange = React.useCallback((text: string, html: string, bodyText: string) => setValue({ text, html, bodyText }), []);
        return { ...value, hasImages: false, setText, onChange };
      },
      EmailBodyEditor: ({ value, disabled, label }: { value: string; disabled: boolean; label: string }) => React.createElement("textarea", { value, disabled, "aria-label": label, readOnly: true }),
    },
    "@/components/email-message-list": { EmailMessageList: ({ conversations, onOpen }: { conversations: Array<{ id: string; latest: { subject: string } }>; onOpen: (conversation: unknown) => void }) => React.createElement("div", {}, conversations.map(conversation => React.createElement("button", { key: conversation.id, onClick: () => onOpen(conversation) }, conversation.latest.subject))) },
    "@/components/ui/dialog": new Proxy({}, { get: (_target, name) => name === "Dialog" ? ({ open, children }: Props) => open ? children : null : Container }),
  };
  const realComponents = new Set(["components/email-inbox.tsx", "components/use-cached-page.ts", "components/email-list-skeleton.tsx", "components/use-email-reply-operation.ts", "components/email-reply-status.tsx", "components/ui/notification-toast.tsx", "components/ui/sonner.tsx"]);
  const fetchMock: typeof fetch = async (url, init) => {
    if (String(url) === "/api/email/state") return Response.json({ ok: true });
    if (String(url).startsWith("/api/email/follow-up?")) return Response.json({ actions: [] });
    if (String(url) !== "/api/email/reply" && !String(url).startsWith("/api/email/page?")) throw new Error(`Unexpected request: ${url}`);
    return new Promise<Response>(resolveResponse => requests.push({ url: String(url), init, resolve: resolveResponse }));
  };
  function load(file: string): unknown {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(source, { exports, console, AbortController, DOMException, Error, Response, URL, URLSearchParams, crypto, Buffer,
      window, document, setTimeout, clearTimeout, setInterval, clearInterval, fetch: fetchMock,
      require(name: string) {
        if (name === "react") return React;
        if (name === "server-only" || name.endsWith(".css")) return {};
        if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
        if (name === "next-themes") return { useTheme: () => ({ resolvedTheme: "light" }) };
        if (name === "next/link") return Container;
        if (name === "next/dynamic") return () => Empty;
        if (name === "@/lib/billing/credit-events") return { notifyAiCreditsChanged() {} };
        if (name in componentMocks) return componentMocks[name];
        if (name.startsWith("@/") || name.startsWith(".")) {
          let target = name.startsWith("@/") ? resolve(repo, name.slice(2)) : resolve(dirname(file), name);
          if (!existsSync(target)) target += existsSync(`${target}.ts`) ? ".ts" : ".tsx";
          const relative = target.slice(repo.length).replaceAll("\\", "/");
          if (relative.startsWith("components/") && !realComponents.has(relative))
            return new Proxy({}, { get: () => Container });
          return load(target);
        }
        return require(name);
      },
    }, { filename: file });
    return exports;
  }
  const { EmailInboxWorkspace } = load(resolve(repo, "components/email-inbox.tsx")) as typeof import("../components/email-inbox.tsx");
  const { Toaster } = load(resolve(repo, "components/ui/sonner.tsx")) as typeof import("../components/ui/sonner.tsx");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const messages = Array.from({ length: paginated ? 30 : 2 }, (_, i) => i + 1).map(index => ({ id: `message-${index}`, threadId: `thread-${index}`, ...(paginated ? { listConversationKey: `thread-${index}` } : {}), messageId: `<message-${index}@example.test>`, direction: "inbound" as const, status: "received", subject: `Question ${index}`, contact: `buyer${index}@example.test`, company: "Buyer", body: "What colors are available?", preview: "What colors are available?", timestamp: new Date(Date.parse("2026-11-25T00:00:00Z") - index * 60000).toISOString(), bodyLoaded: true, read: true }));
  const pagination = { request: emailPageRequestSchema.parse({}), total: 65, pageSize: 30, revision: "fixture", folderCounts: { inbox: 65 }, followupCounts: { all: 0, ai: 0, manual: 0, completed: 0, nurture: 0 } };
  await React.act(() => root.render(React.createElement(React.Fragment, {}, React.createElement(EmailInboxWorkspace, {
    initialEmails: messages, initialThreadId: "thread-1", initialReplyOpen: false,
    initialPage: paginated ? pagination : undefined,
    mailboxConfigured: true, sendConfigured: true, inboxConfigured: canSync, inboxError: null, aiConfigured: true,
    defaultMailboxEmail: "sales@example.test", mailboxes: [{ id: "sales", email: "sales@example.test", type: "personal", sendConfigured: true, inboxConfigured: false }], selectedMailboxId: paginated ? "sales" : null, defaultSenderId: "sales", dataMode: "live",
    initialAutomation: { enabled: false, queueCount: 0, steps: [] }, products: [], catalogs: [],
  }), React.createElement(Toaster))));
  return { host, requests, messages, pagination, refresh: () => backgroundRefresh(),
    async click(label: string) {
      const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label);
      assert.ok(button, `Missing button: ${label}`);
      assert.equal(button.disabled, false, `Disabled button: ${label}`);
      await React.act(async () => button.click());
    },
    async respond(index: number, body: unknown, status = 200) {
      await React.act(async () => { requests[index].resolve(Response.json(body, { status })); });
    },
    async close() { await React.act(() => root.unmount()); host.remove(); },
  };
}

test("inbox AI reply uses local progress, cancels cleanly, and inserts only its current result", async () => {
  const ui = await mount();
  try {
    await ui.click("AI reply");
    assert.equal(ui.requests.length, 1);
    assert.match(ui.host.querySelector('[role="status"]')?.textContent ?? "", /Reading the conversation/);
    assert.equal(ui.host.querySelectorAll("[data-sonner-toast]").length, 0);
    assert.equal(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="Reply message"]')!.disabled, true);
    await ui.click("Cancel");
    assert.equal(ui.requests[0].init?.signal?.aborted, true);
    assert.equal(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="Reply message"]')!.disabled, false);
    await ui.click("AI reply");
    await ui.respond(0, { plan: { body: "Old reply", attachCatalog: false, invoiceItems: [] } });
    assert.equal(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="Reply message"]')!.value, "");
    await ui.respond(1, { plan: { body: "Our PLA comes in black and white.", attachCatalog: false, invoiceItems: [] } });
    assert.equal(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="Reply message"]')!.value, "Our PLA comes in black and white.");
    assert.equal(ui.host.querySelectorAll("[data-sonner-toast]").length, 0);
    assert.doesNotMatch(ui.host.textContent!, /Reading the conversation/);
    assert.ok(ui.requests.every(request => request.url === "/api/email/reply"), "draft generation never sends email");
  } finally { await ui.close(); }
});

test("switching inbox conversations aborts AI work without carrying an error into the new reply", async () => {
  const ui = await mount();
  try {
    await ui.click("AI reply");
    await ui.click("Question 2");
    assert.equal(ui.requests[0].init?.signal?.aborted, true);
    await ui.respond(0, { error: "Late reply error" }, 503);
    assert.doesNotMatch(ui.host.textContent!, /Late reply error|Reading the conversation/);
    assert.equal(ui.host.querySelectorAll("[data-sonner-toast]").length, 0);
    await ui.click("AI reply");
    await ui.respond(1, { error: "The reply service is unavailable." }, 503);
    assert.match(ui.host.querySelector('[role="alert"]')?.textContent ?? "", /reply service is unavailable/);
    assert.equal(ui.host.querySelectorAll("[data-sonner-toast]").length, 0);
    await ui.click("Try again");
    assert.equal(ui.requests.length, 3);
    assert.equal(ui.host.querySelector('[role="alert"]'), null);
    await ui.click("Cancel");
  } finally { await ui.close(); }
});

test("inbox notices mount once with a single close control across reply and contact panels", async () => {
  const ui = await mount();
  try {
    await ui.click("AI reply");
    await ui.click("Cancel");
    await ui.click("Contact and follow-up details");
    await ui.click("Set customer tag");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 45)); });
    const toasts = ui.host.querySelectorAll('[data-sonner-toast][data-removed="false"]');
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].querySelectorAll("button").length, 1, "the host supplies the only close button");
    await ui.click("Close contact details");
    await ui.click("Collapse reply");
    assert.equal(ui.host.querySelectorAll('[data-sonner-toast][data-removed="false"]').length, 1);
    const close = toasts[0].querySelector<HTMLButtonElement>("[data-close-button]")!;
    await React.act(() => close.click());
    await ui.click("Contact and follow-up details");
    assert.equal(ui.host.querySelectorAll('[data-sonner-toast][data-removed="false"]').length, 0);
  } finally { await ui.close(); }
});

test("email paging shows skeletons, requests thirty conversations, and reuses both visited pages", async () => {
  const ui = await mount(true);
  try {
    assert.equal(ui.requests.length, 0);
    await ui.click("Next email page");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    assert.equal(ui.requests.length, 1);
    assert.equal(new URL(ui.requests[0].url, "https://crm.test").searchParams.get("page"), "2");
    assert.ok(ui.host.querySelector('[aria-label="Loading emails…"]'));
    assert.equal(ui.host.querySelector<HTMLButtonElement>('[aria-label="Next email page"]')!.disabled, true);
    const emails = ui.messages.map((message, i) => ({ ...message, id: `page2-${i}`, threadId: `page2-${i}`, listConversationKey: `page2-${i}`, subject: `Page two ${i}` }));
    await ui.respond(0, { emails, pagination: { ...ui.pagination, request: { ...ui.pagination.request, page: 2 } } });
    assert.equal(ui.host.querySelector('[aria-label="Loading emails…"]'), null);
    assert.ok(ui.host.textContent!.includes("Page two 0"));
    assert.ok(ui.host.textContent!.includes("31–60 of 65"));
    await ui.click("Page two 0");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    assert.ok(ui.host.textContent!.includes("31–60 of 65"), "Opening a conversation must retain its server page");
    assert.equal(ui.requests.length, 1);
    await ui.click("Previous email page");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    assert.equal(ui.requests.length, 1, "Previous uses the cached first page");
    assert.ok(ui.host.textContent!.includes("Question 1"));
    await ui.click("Next email page");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    assert.equal(ui.requests.length, 1, "Next reuses the cached second page");
    assert.ok(ui.host.textContent!.includes("Page two 0"));
  } finally { await ui.close(); }
});

test("background revisions preserve visited pages and late refreshes cannot change the current page", async () => {
  const ui = await mount(true, true);
  try {
    await ui.click("Next email page");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    const emails = ui.messages.map((message, i) => ({ ...message, id: `page2-${i}`, threadId: `page2-${i}`, listConversationKey: `page2-${i}`, subject: `Page two ${i}` }));
    const pagination = { ...ui.pagination, request: { ...ui.pagination.request, page: 2 } };
    await ui.respond(0, { emails, pagination });
    let refresh!: Promise<void>;
    await React.act(async () => { refresh = ui.refresh(); });
    assert.equal(ui.requests.length, 2);
    await ui.respond(1, { emails, pagination: { ...pagination, revision: "unrelated-update" } });
    await refresh;
    assert.equal(ui.host.querySelector('[aria-label="Loading emails…"]'), null);
    await ui.click("Previous email page");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    assert.equal(ui.requests.length, 2, "An unrelated revision must preserve cached page one");
    await React.act(async () => { refresh = ui.refresh(); });
    await ui.click("Next email page");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    await ui.respond(2, { emails: [{ ...ui.messages[0], subject: "Late changed first page" }], pagination: { ...ui.pagination, revision: "changed" } });
    await refresh;
    assert.match(ui.host.textContent!, /Page two 0/);
    assert.doesNotMatch(ui.host.textContent!, /Late changed first page/);
    assert.equal(ui.requests.length, 3);
  } finally { await ui.close(); }
});
