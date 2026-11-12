import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
type FormTree = { props: Record<string, (...args: any[]) => void> & { ref: { current: unknown } } }; // eslint-disable-line @typescript-eslint/no-explicit-any
function mount() {
  const timers = new Map<number, () => void>();
  const effects: Array<() => void | (() => void)> = [];
  const navigations: string[] = [];
  let timerId = 0;
  const exports: { LiveSearchForm?: (props: unknown) => FormTree } = {};
  class Input { value = "PLA"; }
  const input = new Input();
  const code = ts.transpileModule(readFileSync(new URL("../components/ui/live-search-form.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, {
    exports, URLSearchParams, HTMLInputElement: Input,
    document: { activeElement: input }, window: { location: { pathname: "/purchase-orders", search: "" } },
    FormData: class { *[Symbol.iterator]() { yield ["q", input.value]; yield ["status", "confirmed"]; yield ["sort", "oldest"]; } },
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id: number) => timers.delete(id),
    require: (name: string) => name === "react" ? { useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void) => effects.push(effect) } : name === "next/navigation" ? { useRouter: () => ({ replace: (href: string) => navigations.push(href) }) } : require(name),
  });
  const tree = exports.LiveSearchForm!({ action: "/purchase-orders", searchValue: "", children: null });
  tree.props.ref.current = { elements: { namedItem: () => input } };
  const cleanups = effects.map(effect => effect());
  function flush() { const work = [...timers.values()]; timers.clear(); work.forEach(callback => callback()); }
  return { props: tree.props, timers, navigations, input, flush, unmount: () => cleanups.forEach(cleanup => { if (typeof cleanup === "function") cleanup(); }) };
}
test("live search groups keystrokes and preserves status and sorting", () => {
  const form = mount();
  form.props.onChange(); form.input.value = "PLA black"; form.props.onChange();
  assert.equal(form.timers.size, 1);
  assert.equal(form.navigations.length, 0);
  form.flush();
  assert.deepEqual(form.navigations, ["/purchase-orders?q=PLA+black&status=confirmed&sort=oldest"]);
});
test("composition and unmount cancel pending navigation", () => {
  const form = mount();
  form.props.onChange(); form.props.onCompositionStart();
  form.props.onChange(); assert.equal(form.timers.size, 0);
  form.props.onCompositionEnd(); assert.equal(form.timers.size, 1);
  form.unmount(); form.flush(); assert.equal(form.navigations.length, 0);
});
test("Enter searches immediately without a page reload, and clearing removes q", () => {
  const form = mount(); let prevented = false;
  form.input.value = ""; form.props.onChange();
  form.props.onSubmit({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(form.timers.size, 0);
  assert.deepEqual(form.navigations, ["/purchase-orders?status=confirmed&sort=oldest"]);
});
