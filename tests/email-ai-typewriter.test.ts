import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

type Element = { props: { className?: string; children?: unknown } };
function find(value: unknown, className: string): Element | undefined {
  if (Array.isArray(value)) return value.map(child => find(child, className)).find(Boolean);
  if (!value || typeof value !== "object" || !("props" in value)) return;
  const node = value as Element;
  return node.props.className === className ? node : find(node.props.children, className);
}

function writer(reducedMotion = false) {
  const values: unknown[] = [];
  const effects: Array<() => () => void> = [];
  const frames = new Map<number, (now: number) => void>();
  let cursor = 0, nextFrame = 0, completed = 0;
  const jsx = (_type: unknown, props: unknown) => ({ props });
  const react = {
    memo: (component: unknown) => component,
    useState(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], (value: unknown) => { values[index] = value; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect: () => () => void) { const index = cursor++; if (!(index in values)) { values[index] = true; effects.push(effect); } },
    useEffectEvent: (callback: unknown) => callback,
  };
  const exports = {} as { EmailAiTypewriter: (props: unknown) => unknown };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/email-ai-typewriter.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require: (name: string) => { assert.ok(name === "react" || name === "react/jsx-runtime"); return name === "react" ? react : { jsx, jsxs: jsx }; },
    window: {
      matchMedia: () => ({ matches: reducedMotion }),
      requestAnimationFrame(callback: (now: number) => void) { frames.set(++nextFrame, callback); return nextFrame; },
      cancelAnimationFrame(id: number) { frames.delete(id); },
    },
  });
  const draft = "Hello 👋,\nDo you have any questions about your quote?";
  const render = () => { cursor = 0; return exports.EmailAiTypewriter({ text: draft, updating: false, onComplete: () => completed++ }); };
  render();
  const cleanup = effects[0]();
  const tick = (now: number) => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); };
  const visible = () => (find(render(), "email-ai-typewriter-text")?.props.children as unknown[])[0];
  return { draft, tick, visible, cleanup, completed: () => completed, pending: () => frames.size };
}

test("typing reveals the full Unicode draft before completing once", () => {
  const app = writer();
  app.tick(0); app.tick(200);
  const partial = String(app.visible());
  assert.ok(partial.length > 0 && partial.length < app.draft.length);
  assert.ok(app.draft.startsWith(partial));
  assert.equal(app.completed(), 0);
  app.tick(2000);
  assert.equal(app.visible(), app.draft);
  assert.equal(app.completed(), 1);
  assert.equal(app.pending(), 0);
});

test("reduced motion reveals immediately and unmount cancels unfinished typing", () => {
  const reduced = writer(true); reduced.tick(0);
  assert.equal(reduced.visible(), reduced.draft);
  assert.equal(reduced.completed(), 1);
  const cancelled = writer(); cancelled.tick(0); cancelled.cleanup(); cancelled.tick(2000);
  assert.equal(cancelled.pending(), 0);
  assert.equal(cancelled.completed(), 0);
});
