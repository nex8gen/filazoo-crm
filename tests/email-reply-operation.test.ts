import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";

const dom = new JSDOM("<!doctype html><body></body>");
for (const key of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent"] as const)
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
function load<T>(file: string): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, AbortController, require: (name: string) => name === "react" ? React : require(name) });
  return exports as T;
}
const { useEmailReplyOperation } = load<typeof import("../components/use-email-reply-operation.ts")>("../components/use-email-reply-operation.ts");
const { EmailReplyStatus } = load<typeof import("../components/email-reply-status.tsx")>("../components/email-reply-status.tsx");
const { EmailDraftStatus } = load<typeof import("../components/email-draft-status.tsx")>("../components/email-draft-status.tsx");
type Operation = ReturnType<typeof useEmailReplyOperation>;

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: Operation;
  let retried = 0;
  function Harness({ scope }: { scope: string }) {
    const operation = useEmailReplyOperation(scope);
    current = operation;
    return React.createElement(React.Fragment, {},
      React.createElement("textarea", { disabled: operation.busy, "aria-label": "Reply" }),
      React.createElement(EmailReplyStatus, { progress: operation.progress, error: operation.error,
        onCancel: operation.cancel, onDismiss: operation.cancel,
        onRetry() { retried++; operation.start("Reading the conversation…"); } }));
  }
  async function render(scope: string) {
    await React.act(() => root.render(React.createElement(React.StrictMode, {}, React.createElement(Harness, { scope }))));
  }
  await render("mailbox-1:conversation-1:draft-1");
  return { host, render, operation: () => current!, retries: () => retried,
    async click(label: string) {
      const button = [...host.querySelectorAll("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label);
      assert.ok(button, `Missing ${label}`);
      await React.act(() => button.click());
    },
    async close() { await React.act(() => root.unmount()); host.remove(); },
  };
}

test("AI progress updates one local status and blocks duplicate starts", async () => {
  const ui = await mount();
  try {
    assert.equal(ui.host.querySelector('[role="status"]'), null);
    let request: ReturnType<Operation["start"]>;
    await React.act(() => {
      request = ui.operation().start("Reading the conversation…");
      assert.equal(ui.operation().start("Duplicate"), null, "guard repeated clicks before React renders");
    });
    assert.equal(ui.host.querySelectorAll('[role="status"]').length, 1);
    assert.equal(ui.host.querySelector("textarea")!.disabled, true);
    await React.act(() => request!.update("Preparing the catalog PDF…"));
    assert.equal(ui.host.querySelectorAll('[role="status"]').length, 1);
    assert.match(ui.host.textContent!, /Preparing the catalog PDF/);
    assert.doesNotMatch(ui.host.textContent!, /Reading the conversation/);
    await React.act(() => request!.finish());
    assert.equal(ui.operation().busy, false);
    assert.equal(ui.host.querySelector('[role="status"]'), null);
    assert.equal(ui.host.querySelector("textarea")!.disabled, false);
  } finally { await ui.close(); }
});

test("Cancel aborts work, restores editing, and ignores late results from the cancelled request", async () => {
  const ui = await mount();
  try {
    let previous: ReturnType<Operation["start"]>;
    await React.act(() => { previous = ui.operation().start("Reading…"); });
    await ui.click("Cancel");
    assert.equal(previous!.signal.aborted, true);
    assert.equal(previous!.isCurrent(), false);
    assert.equal(ui.host.querySelector("textarea")!.disabled, false);
    await React.act(() => { ui.operation().start("New request"); });
    await React.act(() => { previous!.fail("Old failure"); previous!.finish(); previous!.update("Old progress"); });
    assert.equal(ui.operation().busy, true);
    assert.equal(ui.operation().progress, "New request");
    assert.equal(ui.operation().error, null);
  } finally { await ui.close(); }
});

test("changing reply ownership cancels its request and never restores old progress or errors", async () => {
  const ui = await mount();
  try {
    let previous: ReturnType<Operation["start"]>;
    await React.act(() => { previous = ui.operation().start("First conversation"); });
    await ui.render("mailbox-1:conversation-2:draft-2");
    assert.equal(previous!.signal.aborted, true);
    assert.equal(ui.operation().busy, false);
    await React.act(() => previous!.fail("A late failure"));
    assert.equal(ui.host.querySelector('[role="alert"]'), null);
    await React.act(() => { ui.operation().start("Second conversation")!.fail("Second failure"); });
    await ui.render("mailbox-1:conversation-1:draft-1");
    await ui.render("mailbox-1:conversation-2:draft-2");
    assert.equal(ui.operation().error, null);
    assert.equal(ui.operation().progress, null);
  } finally { await ui.close(); }
});

test("failures stay beside the reply until retry or dismiss, with no success popup", async () => {
  const ui = await mount();
  try {
    await React.act(() => {
      const request = ui.operation().start("Reading…")!;
      request.fail("Reply service unavailable.");
      request.finish();
    });
    assert.equal(ui.operation().busy, false);
    assert.equal(ui.host.querySelectorAll('[role="alert"]').length, 1);
    assert.match(ui.host.textContent!, /Reply service unavailable/);
    assert.equal(ui.host.querySelector('[role="status"]'), null);
    await ui.click("Try again");
    assert.equal(ui.retries(), 1);
    assert.equal(ui.operation().error, null);
    assert.equal(ui.operation().busy, true);
    await React.act(() => ui.operation().cancel());
    await React.act(() => { ui.operation().start("Retry")!.fail("Still unavailable."); });
    await ui.click("Dismiss reply error");
    assert.equal(ui.host.querySelector('[role="alert"]'), null);
    assert.equal(ui.host.querySelectorAll("button").length, 0);
  } finally { await ui.close(); }
});

test("unmount aborts the active request", async () => {
  const ui = await mount();
  let request: ReturnType<Operation["start"]>;
  await React.act(() => { request = ui.operation().start("Reading…"); });
  await ui.close();
  assert.equal(request!.signal.aborted, true);
  assert.equal(request!.isCurrent(), false);
  request!.finish();
  request!.fail("Late failure");
});

test("draft save failures remain in their composer with an accessible retry action", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let calls = 0;
  const onRetry = () => { calls++; };
  try {
    await React.act(() => root.render(React.createElement(EmailDraftStatus, { status: "Draft could not be saved.", onRetry })));
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /could not be saved/);
    const button = host.querySelector("button")!;
    assert.equal(button.textContent, "Retry save");
    await React.act(() => button.click());
    assert.equal(calls, 1);
    await React.act(() => root.render(React.createElement(EmailDraftStatus, { status: "Draft could not be saved.", onRetry, disabled: true })));
    assert.equal(host.querySelector("button")!.disabled, true);
    await React.act(() => root.render(React.createElement(EmailDraftStatus, { status: "Saving draft…", onRetry })));
    assert.equal(host.querySelector('[role="alert"]'), null);
    assert.equal(host.querySelector("button"), null);
    assert.equal(host.querySelector('[role="status"]')!.textContent, "Saving draft…");
    await React.act(() => root.render(React.createElement(EmailDraftStatus, { status: "Draft saved", onRetry })));
    assert.equal(host.querySelector('[role="status"]')!.textContent, "Draft saved");
  } finally { await React.act(() => root.unmount()); host.remove(); }
});
