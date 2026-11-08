import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness(accept = false) {
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const cleanups: Array<() => void> = [];
  let confirmations = 0;
  const target = {
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, [...listeners.get(type) ?? [], listener]),
    removeEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== listener)),
  };
  class Link {
    target = "";
    href: string;
    constructor(href: string) { this.href = href; }
    closest() { return this; }
    hasAttribute() { return false; }
  }
  const dependencies: Record<string, unknown> = {
    react: { useEffect: (effect: () => (() => void) | undefined) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } },
    "@/components/language-provider": { useLanguage: () => ({ t: (text: string) => text }) },
  };
  const exports: { useUnsavedSettings?: (dirty: boolean) => void } = {};
  const source = ts.transpileModule(readFileSync(new URL("../app/settings/use-unsaved-settings.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => dependencies[name], Element: Link, HTMLAnchorElement: Link, URL,
    document: target, window: { ...target, location: { href: "http://crm.test/settings/invoices" }, confirm: () => { confirmations++; return accept; } } });
  function click(href: string, options: Record<string, unknown> = {}) {
    let prevented = false;
    const event = { target: new Link(href), button: 0, get defaultPrevented() { return prevented; }, preventDefault() { prevented = true; }, stopPropagation() {}, ...options };
    for (const listener of listeners.get("click") ?? []) listener(event);
    return prevented;
  }
  return { mount: exports.useUnsavedSettings!, click, confirmations: () => confirmations, listeners, cleanup: () => cleanups.forEach(cleanup => cleanup()) };
}

test("unsaved business settings block a declined link and allow an accepted link", () => {
  const denied = harness(); denied.mount(true);
  assert.equal(denied.click("http://crm.test/settings/team"), true);
  assert.equal(denied.confirmations(), 1);
  const allowed = harness(true); allowed.mount(true);
  assert.equal(allowed.click("http://crm.test/settings/team"), false);
  assert.equal(allowed.confirmations(), 1);
});

test("two dirty forms ask once, and in-page links or modifier clicks need no warning", () => {
  const f = harness(true); f.mount(true); f.mount(true);
  assert.equal(f.click("http://crm.test/settings/invoices#payment-methods"), false);
  assert.equal(f.click("http://crm.test/settings/team", { ctrlKey: true }), false);
  assert.equal(f.confirmations(), 0);
  assert.equal(f.click("http://crm.test/settings/team"), false);
  assert.equal(f.confirmations(), 1);
});

test("only dirty forms guard tab closing and cleanup removes the guards", () => {
  const clean = harness(); clean.mount(false);
  assert.equal(clean.listeners.size, 0);
  const dirty = harness(); dirty.mount(true);
  let prevented = false;
  const event = { preventDefault() { prevented = true; }, returnValue: undefined };
  dirty.listeners.get("beforeunload")![0](event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, "");
  dirty.cleanup();
  assert.equal(dirty.click("http://crm.test/settings/team"), false);
  assert.equal(dirty.confirmations(), 0);
  assert.equal(dirty.listeners.get("beforeunload")?.length, 0);
});
