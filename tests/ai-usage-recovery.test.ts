import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryHttpError, requestHistoryJson } from "../lib/ai/history-http.ts";
import { createHistoryListCache } from "../lib/ai/history-list-cache.ts";

const require = createRequire(import.meta.url);
type Element = { props?: { children?: unknown; "aria-label"?: string; onClick?: () => void; onRetry?: () => void; retryLabel?: string } };
function findButton(tree: unknown, label: string): Element | undefined {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree)) return tree.map(child => findButton(child, label)).find(Boolean);
  const element = tree as Element;
  const children = element.props?.children;
  const matches = element.props?.["aria-label"] === label || children === label || Array.isArray(children) && children.includes(label);
  return element.props?.onClick && matches || element.props?.retryLabel === label ? element : findButton(children, label);
}

function usageHarness(request: (url: string, init: RequestInit) => Promise<unknown>) {
  const states: unknown[] = [];
  const effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  const pending: Array<() => void> = [];
  const memos: Array<{ deps: unknown[]; value: unknown }> = [];
  let stateIndex = 0, effectIndex = 0, memoIndex = 0;
  const memo = (create: () => unknown, deps: unknown[]) => {
    const index = memoIndex++;
    if (!memos[index] || deps.some((dep, i) => !Object.is(dep, memos[index].deps[i]))) memos[index] = { deps, value: create() };
    return memos[index].value;
  };
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  const ticks = new Set<() => void>();
  const dependencies: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef: () => ({ current: null }),
      useMemo: memo,
      useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
      useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
      useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
        const index = effectIndex++;
        if (effects[index] && deps.every((dep, i) => Object.is(dep, effects[index].deps[i]))) return;
        pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
      },
    },
    "next/navigation": { usePathname: () => "/workflow" },
    "lucide-react": new Proxy({}, { get: () => () => null }),
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/dropdown-menu": new Proxy({}, { get: () => () => null }),
    "./ai-usage-panel": { AiUsagePanel: () => null },
    "@/lib/ai/history-http": { HistoryHttpError, requestHistoryJson: request },
    "@/lib/ai/history-list-cache": { createHistoryListCache: () => createHistoryListCache(async (url, init) => {
      try { return Response.json(await request(String(url), init ?? {})); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "History unavailable" }, { status: 400 }); }
    }) },
  };
  const hookCode = ts.transpileModule(readFileSync(new URL("../components/use-ai-history-list.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const hookExports = {};
  vm.runInNewContext(hookCode, { exports: hookExports, require: (name: string) => dependencies[name] ?? require(name), setTimeout, clearTimeout });
  dependencies["@/components/use-ai-history-list"] = hookExports;
  const code = ts.transpileModule(readFileSync(new URL("../components/ai-history-menu.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: { AiHistoryMenu?: (props: unknown) => ReturnType<typeof import("react").createElement> } = {};
  vm.runInNewContext(code, {
    exports, require: (name: string) => dependencies[name] ?? require(name), Error, URLSearchParams, AbortController, window, document,
    setInterval: (callback: () => void) => { ticks.add(callback); return callback; },
    clearInterval: (callback: () => void) => ticks.delete(callback), setTimeout, clearTimeout,
  });
  return {
    window, document, ticks,
    render(disabled = false) {
      stateIndex = 0; effectIndex = 0; memoIndex = 0;
      const tree = exports.AiHistoryMenu!({ history: { scope: "test", loading: false }, disabled, onNew: () => {} });
      pending.splice(0).forEach(effect => effect());
      return tree;
    },
    cleanup() { effects.forEach(effect => effect.cleanup?.()); },
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 5));

test("chat keeps history and new chat without usage controls or background allowance reads", async () => {
  const calls: string[] = [];
  const harness = usageHarness(async url => {
    calls.push(url);
    throw new Error("Saved conversations unavailable");
  });
  const tree = harness.render();
  assert.equal(findButton(tree, "AI usage"), undefined);
  assert.ok(findButton(tree, "History"));
  assert.ok(findButton(tree, "New chat"));
  harness.window.dispatchEvent(new Event("focus"));
  harness.document.dispatchEvent(new Event("visibilitychange"));
  harness.ticks.forEach(tick => tick());
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(harness.ticks.size, 0);
  findButton(tree, "History")!.props!.onClick!();
  harness.render(); await flush();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith("/api/ai/history?"));
  const html = renderToStaticMarkup(harness.render());
  assert.match(html, /Saved conversations unavailable/);
  assert.doesNotMatch(html, /AI usage|Loading usage|Retry loading usage/);
  harness.cleanup();
});

test("usage transport failures name usage rather than saved conversations", async t => {
  await assert.rejects(requestHistoryJson("/api/ai/usage", undefined, async () => { throw new TypeError("offline"); }), /AI usage is temporarily unavailable/);
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new DOMException("Timed out", "TimeoutError")));
  await assert.rejects(requestHistoryJson("/api/ai/usage", undefined, async () => { throw new TypeError("offline"); }), /AI usage took too long/);
});
