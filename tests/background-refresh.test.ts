import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Recreate Activity's effect cleanup/resume while keeping React refs intact.
function mount(intervalSeconds = 15, enabled = true) {
  let now = 0;
  let calls = 0;
  let cleanup: (() => void) | undefined;
  let effect: () => (() => void) | undefined;
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
    setTimeout: (callback: () => void) => { const id = ++nextTimer; timeouts.set(id, callback); return id; },
    clearTimeout: (id: number) => timeouts.delete(id),
    setInterval: (callback: () => void) => { const id = ++nextTimer; intervals.set(id, callback); return id; },
    clearInterval: (id: number) => intervals.delete(id),
    addEventListener: document.addEventListener,
    removeEventListener: document.removeEventListener,
  };
  const exports = {} as { useBackgroundRefresh: (refresh: () => Promise<void>, enabled: boolean, seconds: number) => void };
  const code = ts.transpileModule(readFileSync(new URL("../components/use-background-refresh.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, window, document, Date: { now: () => now },
    require: () => ({
      useRef: (current: unknown) => ({ current }),
      useEffect: (callback: typeof effect) => { effect = callback; },
    }),
  });
  exports.useBackgroundRefresh(async () => { calls++; }, enabled, intervalSeconds);
  const resume = () => { cleanup = effect?.(); };
  const flush = () => { for (const [id, callback] of timeouts) { timeouts.delete(id); callback(); } };
  resume();
  return {
    calls: () => calls,
    advance: (ms: number) => { now += ms; },
    flush,
    hide: () => cleanup?.(),
    resume,
    focus: () => listeners.get("focus")?.(),
    visibility: (state: string) => { document.visibilityState = state; listeners.get("visibilitychange")?.(); },
    poll: () => { for (const callback of intervals.values()) callback(); },
    pending: () => timeouts.size + intervals.size + listeners.size,
  };
}

test("returning to a recently visited inbox keeps its snapshot without another automatic sync", () => {
  const page = mount();
  page.flush();
  assert.equal(page.calls(), 1);
  page.hide();
  assert.equal(page.pending(), 0);
  page.advance(1_000);
  page.resume();
  page.flush();
  page.focus();
  assert.equal(page.calls(), 1);
  page.advance(14_000);
  page.poll();
  assert.equal(page.calls(), 2);
});

test("an older inbox refreshes on return and simultaneous focus events deduplicate", () => {
  const page = mount(30);
  page.flush();
  page.hide();
  page.advance(30_000);
  page.resume();
  page.focus();
  page.flush();
  page.visibility("visible");
  assert.equal(page.calls(), 2);
});

test("background tabs and hidden routes do not poll", () => {
  const page = mount();
  page.visibility("hidden");
  page.flush();
  page.poll();
  page.focus();
  assert.equal(page.calls(), 0);
  page.visibility("visible");
  assert.equal(page.calls(), 1);
  page.hide();
  page.advance(60_000);
  page.poll();
  page.focus();
  assert.equal(page.calls(), 1);
});

test("disabled polling still allows throttled focus refresh, and unconfigured inboxes do no work", () => {
  const page = mount(0);
  page.flush();
  page.advance(30_000);
  page.poll();
  assert.equal(page.calls(), 1);
  page.focus();
  page.focus();
  assert.equal(page.calls(), 2);
  const unconfigured = mount(15, false);
  unconfigured.flush();
  unconfigured.focus();
  assert.equal(unconfigured.calls(), 0);
  assert.equal(unconfigured.pending(), 0);
});
