import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function fixture() {
  let now = 0, calls = 0, transitioned = false;
  let effect: () => (() => void) | undefined;
  let cleanup: (() => void) | undefined;
  const pages = { current: new Map<string, number>() };
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  let nextTimer = 0;
  const document = {
    visibilityState: "visible",
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const window = {
    location: { search: "" },
    setTimeout: (callback: () => void) => { const id = ++nextTimer; timeouts.set(id, callback); return id; },
    clearTimeout: (id: number) => timeouts.delete(id),
    setInterval: (callback: () => void) => { const id = ++nextTimer; intervals.set(id, callback); return id; },
    clearInterval: (id: number) => intervals.delete(id),
    addEventListener: document.addEventListener,
    removeEventListener: document.removeEventListener,
  };
  const router = { refresh() { assert.ok(transitioned, "refresh must preserve visible content with a transition"); calls++; } };
  const api = {} as { useVisitedPageRefresh: (path: string, enabled: boolean) => void };
  const code = ts.transpileModule(readFileSync(new URL("../components/use-visited-page-refresh.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports: api, window, document, Date: { now: () => now }, Map,
    require: (name: string) => name === "react" ? {
      useRef: () => pages,
      useEffect: (callback: typeof effect) => { effect = callback; },
      startTransition: (callback: () => void) => { transitioned = true; callback(); transitioned = false; },
    } : { useRouter: () => router, useSearchParams: () => ({ toString: () => window.location.search }) },
  });
  return {
    visit(path: string, enabled = true, search = "") { cleanup?.(); window.location.search = search; api.useVisitedPageRefresh(path, enabled); cleanup = effect?.(); },
    flush() { for (const [id, callback] of timeouts) { timeouts.delete(id); callback(); } },
    advance(ms: number) { now += ms; },
    focus() { listeners.get("focus")?.(); },
    visibility(state: string) { document.visibilityState = state; listeners.get("visibilitychange")?.(); },
    hide() { cleanup?.(); },
    poll() { for (const callback of intervals.values()) callback(); },
    calls: () => calls,
    pending: () => timeouts.size + intervals.size + listeners.size,
  };
}

test("first visits and recent sidebar round trips do not refetch pages", () => {
  const page = fixture();
  for (const path of ["/companies", "/settings", "/products", "/invoices", "/segments", "/companies"]) {
    page.visit(path); page.flush(); page.focus(); page.advance(1000);
  }
  assert.equal(page.calls(), 0);
});

test("an older cached page renders first and then refreshes once in a transition", () => {
  const page = fixture();
  page.visit("/companies"); page.flush();
  page.visit("/settings"); page.advance(300_000);
  page.visit("/companies");
  assert.equal(page.calls(), 0);
  page.flush(); page.focus(); page.visibility("visible");
  assert.equal(page.calls(), 1);
});

test("query-specific visits have their own freshness and hidden pages stop work", () => {
  const page = fixture();
  page.visit("/companies", true, "?segment=one"); page.flush(); page.advance(300_000);
  page.visit("/companies", true, "?segment=two"); page.flush();
  assert.equal(page.calls(), 0);
  page.visibility("hidden"); page.advance(300_000); page.poll();
  assert.equal(page.calls(), 0);
  page.visibility("visible");
  assert.equal(page.calls(), 1);
  page.hide(); assert.equal(page.pending(), 0);
  page.advance(300_000); page.poll(); page.focus();
  assert.equal(page.calls(), 1);
});

test("public screens and workspaces with their own polling add no requests or listeners", () => {
  const page = fixture();
  page.visit("/login", false); page.flush(); page.advance(300_000); page.poll(); page.focus();
  assert.equal(page.calls(), 0); assert.equal(page.pending(), 0);
});
