import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture(native: boolean, nested = false) {
  const frames = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  const properties = new Map<string, string>();
  let sequence = 0;
  let scroll = 0;
  let nativeOffset = 0;
  let observed = 0;
  let unobserved = 0;
  let mutation: () => void = () => {};
  let resize: () => void = () => {};
  const owner = {
    dataset: {} as Record<string, string>, clientTop: 0, clientHeight: 900,
    scrollHeight: 3000, scrollTop: 0, parentElement: null,
    getBoundingClientRect: () => ({ top: 0 }),
  };
  const viewport = {
    dataset: {} as Record<string, string>, clientTop: nested ? 2 : 0, clientHeight: nested ? 240 : 1600,
    scrollHeight: 1600, scrollTop: 0, parentElement: owner,
    getBoundingClientRect: () => ({ top: nested ? 100 : 300 - scroll }),
  };
  const tableTop = () => nested ? 202 - viewport.scrollTop : 300 - scroll;
  const header = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
    getBoundingClientRect: () => ({
      top: tableTop() + (native ? nativeOffset : parseFloat(properties.get("--crm-table-header-offset") ?? "0")), height: 36,
    }),
  };
  const table = {
    tHead: header, parentElement: viewport, getClientRects: () => [1],
    getBoundingClientRect: () => ({ top: tableTop(), bottom: tableTop() + 1600 }),
  };
  const root = { querySelectorAll: () => [table] };
  const exports: { stickyTableHeaders?: (root: unknown) => () => void } = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/sticky-table-headers.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, document: { scrollingElement: owner }, CSS: { supports: () => native },
    DOMMatrixReadOnly: class { m42 = nativeOffset; },
    getComputedStyle: (element: unknown) => ({
      overflowY: element === viewport ? "auto" : "visible",
      transform: nativeOffset ? "matrix(1,0,0,1,0,1)" : "none",
      getPropertyValue: () => "32px",
    }),
    ResizeObserver: class {
      constructor(callback: () => void) { resize = callback; }
      observe() { observed++; }
      unobserve() { unobserved++; }
      disconnect() {}
    },
    MutationObserver: class {
      constructor(callback: () => void) { mutation = callback; }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback: () => void) => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    window: {
      addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
      removeEventListener: (event: string) => listeners.delete(event),
    },
  });
  const cleanup = exports.stickyTableHeaders!(root);
  const flush = () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback()); };
  flush();
  return {
    properties, header, owner, viewport, listeners, cleanup, flush, resize, mutation,
    get observed() { return observed; }, get unobserved() { return unobserved; },
    scroll(value: number) { scroll = value; owner.scrollTop = value; listeners.get("scroll")?.(); flush(); },
    setNativeOffset(value: number) { nativeOffset = value; },
  };
}

test("modern browsers pin at a 32px gap without a JavaScript scroll listener", () => {
  const view = fixture(true);
  assert.equal(view.listeners.has("scroll"), false);
  assert.equal(view.header.dataset.crmStickyHeader, "native");
  assert.equal(view.properties.get("--crm-table-pin-start"), "268px");
  assert.equal(view.properties.get("--crm-table-pin-end"), "1832px");
  assert.equal(view.properties.get("--crm-table-pin-distance"), "1564px");
  assert.equal(view.owner.dataset.crmTableScroll, "");
  view.cleanup();
  assert.equal(view.header.dataset.crmStickyHeader, undefined);
  assert.equal(view.owner.dataset.crmTableScroll, undefined);
  assert.equal(view.properties.size, 0);
  assert.equal(view.listeners.size, 0);
});

test("layout refreshes do not restart observers or shift a pinned header", () => {
  const view = fixture(true);
  const count = view.observed;
  view.scroll(450);
  view.setNativeOffset(182);
  view.resize();
  view.flush();
  view.mutation();
  view.flush();
  assert.equal(view.observed, count);
  assert.equal(view.unobserved, 0);
  assert.equal(view.properties.get("--crm-table-pin-start"), "268px");
  assert.equal(view.properties.get("--crm-table-pin-distance"), "1564px");
  view.cleanup();
});

test("nested panes use their own scroll timeline and preserve the top gap", () => {
  const view = fixture(true, true);
  assert.equal(view.viewport.dataset.crmTableScroll, "");
  assert.equal(view.owner.dataset.crmTableScroll, undefined);
  assert.equal(view.properties.get("--crm-table-pin-start"), "68px");
  view.cleanup();
});

test("compatibility scrolling retains the gap, releases at table end, and restores on upward scroll", () => {
  const view = fixture(false);
  assert.equal(view.properties.get("--crm-table-header-offset"), "0px");
  for (const depth of [450, 550, 675, 450]) {
    view.scroll(depth);
    assert.equal(view.properties.get("--crm-table-header-offset"), `${depth - 268}px`);
  }
  view.scroll(1882);
  assert.equal(view.properties.get("--crm-table-header-offset"), "1564px");
  view.scroll(0);
  assert.equal(view.properties.get("--crm-table-header-offset"), "0px");
  view.cleanup();
});
