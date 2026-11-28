import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function fixture(enabled = true, online = true) {
  let calls = 0, transitioned = false;
  let effect: () => (() => void) | undefined;
  const disconnected = { current: false };
  const listeners = new Map<string, () => void>();
  const document = {
    visibilityState: "visible",
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const window = { addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  const navigator = { onLine: online };
  const router = { refresh() { assert.ok(transitioned); calls++; } };
  const api = {} as { useSessionRecoveryRefresh: (enabled: boolean) => void };
  const code = ts.transpileModule(readFileSync(new URL("../components/use-session-recovery-refresh.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports: api, window, document, navigator,
    require: (name: string) => name === "react" ? {
      useRef: () => disconnected,
      useEffect: (callback: typeof effect) => { effect = callback; },
      startTransition: (callback: () => void) => { transitioned = true; callback(); transitioned = false; },
    } : { useRouter: () => router },
  });
  api.useSessionRecoveryRefresh(enabled);
  let cleanup = effect?.();
  return {
    connection(online: boolean) { navigator.onLine = online; listeners.get(online ? "online" : "offline")?.(); },
    visibility(state: string) { document.visibilityState = state; listeners.get("visibilitychange")?.(); },
    focus() { listeners.get("focus")?.(); },
    resume() { cleanup?.(); cleanup = effect?.(); },
    hide() { cleanup?.(); },
    calls: () => calls,
    pending: () => listeners.size,
  };
}

test("revisiting pages, focusing the tab and resuming Activity preserve route memory", () => {
  const page = fixture();
  for (let i = 0; i < 10; i++) {
    page.focus(); page.visibility("hidden"); page.visibility("visible"); page.resume();
  }
  assert.equal(page.calls(), 0);
  page.connection(true);
  assert.equal(page.calls(), 0, "An online event without an outage does not evict routes");
});

test("network recovery refreshes once in a transition", () => {
  const page = fixture();
  page.connection(false); page.connection(true); page.connection(true); page.focus();
  assert.equal(page.calls(), 1);
  page.connection(false); page.connection(true);
  assert.equal(page.calls(), 2);
});

test("background tabs defer network recovery until visible", () => {
  const page = fixture();
  page.visibility("hidden"); page.connection(false); page.connection(true);
  assert.equal(page.calls(), 0);
  page.visibility("visible"); page.visibility("visible");
  assert.equal(page.calls(), 1);
});

test("an offline mount recovers, disabled public screens do no work and cleanup removes listeners", () => {
  const page = fixture(true, false);
  page.connection(true);
  assert.equal(page.calls(), 1);
  page.hide(); assert.equal(page.pending(), 0);
  page.connection(false); page.connection(true);
  assert.equal(page.calls(), 1);
  const publicPage = fixture(false);
  publicPage.connection(false); publicPage.connection(true);
  assert.equal(publicPage.calls(), 0); assert.equal(publicPage.pending(), 0);
});
