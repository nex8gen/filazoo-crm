import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import * as threading from "../lib/email-threading.ts";
import * as activity from "../lib/task-activity.ts";
import * as actions from "../lib/activity-action.ts";
import * as paths from "../lib/flow-conversation-path.ts";
import { emailDeepLinkSelection } from "../lib/email-deep-link.ts";

const require = createRequire(import.meta.url);
const dom = new JSDOM("<!doctype html><body></body>");
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, window, require: (name: string) => dependencies[name] ?? require(name) });
  return exports as T;
}

const { useEmailReplyLink } = load<typeof import("../components/use-email-reply-link.ts")>("../components/use-email-reply-link.ts", { react: React, "@/lib/email-threading": threading });
const items = load<{ NotificationItem: React.ComponentType<{ alert: activity.ActivityAlert; now: Date; onRead(): void }>; TaskItem: React.ComponentType<{ task: activity.ActivityTask; now: Date; compact: boolean }> }>("../components/activity-items.tsx", {
  "next/link": ({ href, children, ...props }: React.PropsWithChildren<{ href: string }>) => React.createElement("a", { href, ...props }, children),
  "next/dynamic": () => () => null,
  "@/components/ui/button": { Button: "button" },
  "@/components/ui/dropdown-menu": {},
  "@/lib/task-activity": activity,
  "@/components/company-avatar": { CompanyAvatar: () => null },
  "@/lib/activity-action": actions,
  "@/lib/flow-conversation-path": paths,
});

test("email notifications provide Reply plus View task and ordinary tasks keep their task link", () => {
  const alert: activity.ActivityAlert = { id: "alert", task_id: "task", message: "Task assigned: Follow up with customer", channel: "in_app", conversation_id: null, include_thread_link: false, read_at: null, created_at: "2026-11-18T07:05:00Z", reply_href: activity.taskEmailReplyPath("thread:<buyer@example.com>", "mailbox") };
  const now = new Date("2026-11-18T07:06:00Z");
  const html = renderToStaticMarkup(React.createElement(items.NotificationItem, { alert, now, onRead() {} }));
  const page = new JSDOM(html).window.document;
  const links = [...page.querySelectorAll("a")];
  const reply = links.find(link => link.textContent === "Reply");
  assert.ok(reply);
  assert.equal(new URL(reply.href, "https://crm.example.com").searchParams.get("reply"), "1");
  assert.equal(links.find(link => link.textContent === "View task")?.getAttribute("href"), "/tasks?task=task");
  const ordinary = renderToStaticMarkup(React.createElement(items.NotificationItem, { alert: { ...alert, reply_href: null }, now, onRead() {} }));
  assert.match(ordinary, /Open task/);
  assert.doesNotMatch(ordinary, />Reply<|View task/);
  const review = renderToStaticMarkup(React.createElement(items.NotificationItem, { alert: { ...alert, message: "Shipping approval required: review shipping" }, now, onRead() {} }));
  assert.doesNotMatch(review, />Reply</);
});

test("the same Reply action is available from My tasks", () => {
  const task: activity.ActivityTask = { id: "task", title: "Follow up", notes: null, priority: "normal", company_id: null, due_at: null, updated_at: "2026-11-18T07:05:00Z", reply_href: "/email?mailbox=mine&thread=thread&reply=1" };
  const html = renderToStaticMarkup(React.createElement(items.TaskItem, { task, now: new Date(), compact: true }));
  assert.match(html, />Reply</);
  assert.match(html, /Email follow-up/);
});

test("a linked Inbox message classified as custom opens in All mail and selects the latest customer reply", () => {
  const original = { id: "original", threadId: "customer-thread", direction: "inbound" as const, timestamp: "2026-11-18T06:57:55Z", folder: "inbox", providerKind: "custom" };
  const reply = { ...original, id: "latest-customer-reply", timestamp: "2026-11-18T07:02:52Z" };
  const sent = { ...original, id: "our-newer-response", direction: "outbound" as const, timestamp: "2026-11-18T07:07:15Z", providerKind: "sent" };
  const selected = emailDeepLinkSelection([original, sent, reply], "customer-thread");
  assert.equal(selected?.message.id, reply.id);
  assert.equal(selected?.folder, "all", "Inbox filters exclude custom provider labels");
  assert.equal(emailDeepLinkSelection([], "customer-thread"), null);
  assert.equal(emailDeepLinkSelection([reply], "another-thread"), null);
  assert.equal(emailDeepLinkSelection([reply], undefined), null);
  assert.equal(emailDeepLinkSelection([{ ...reply, folder: "trash" }], "customer-thread")?.folder, "trash");
  assert.equal(emailDeepLinkSelection([{ ...reply, providerKind: "spam" }], "customer-thread")?.folder, "spam");
});

test("reply links wait for the matching thread and draft, focus once, and preserve draft text", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const pendingThread = { current: "intended-thread" as string | undefined };
  function Composer({ messages, ready }: { messages: threading.EmailThreadMetadata[]; ready: boolean }) {
    const [expanded, setExpanded] = React.useState(false);
    const input = React.useRef<HTMLTextAreaElement>(null);
    useEmailReplyLink({ pendingThreadRef: pendingThread, messages, ready, setExpanded, input });
    return React.createElement("textarea", { ref: input, hidden: !expanded, defaultValue: "Saved customer reply draft" });
  }
  async function render(messages: threading.EmailThreadMetadata[], ready: boolean) {
    await React.act(() => root.render(React.createElement(Composer, { messages, ready })));
    await React.act(() => new Promise(resolve => setTimeout(resolve, 5)));
  }
  try {
    await render([{ id: "wrong", threadId: "another-thread" }], true);
    assert.equal(host.querySelector("textarea")!.hidden, true);
    const messages = [{ id: "latest-inbound", threadId: "intended-thread" }];
    await render(messages, false);
    assert.equal(host.querySelector("textarea")!.hidden, true);
    await render(messages, true);
    const input = host.querySelector("textarea")!;
    assert.equal(input.hidden, false);
    assert.equal(document.activeElement, input);
    assert.equal(input.value, "Saved customer reply draft");
    assert.equal(pendingThread.current, undefined);
    input.blur();
    await render([...messages], true);
    assert.notEqual(document.activeElement, input, "Mailbox polling must not repeatedly steal focus");
  } finally {
    await React.act(() => root.unmount());
    host.remove();
  }
});
