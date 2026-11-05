import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
test("a finished AI answer has one text copy for visual display, assistive technology and clipboard selection", () => {
  const source = readFileSync(new URL("../components/ui/ai-agent-response.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: { StreamingText?: (props: unknown) => unknown } = {};
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return { useState: () => [0, () => {}], useEffect: () => {}, useEffectEvent: (fn: unknown) => fn, useSyncExternalStore: () => false };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "cn") return { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") };
    return {};
  } });
  const text = "The catalog draft is ready for review.";
  const { renderToStaticMarkup } = require("react-dom/server");
  const markup = renderToStaticMarkup(exports.StreamingText!({ text, animate: false }));
  assert.equal(markup.split(text).length - 1, 1);
  assert.doesNotMatch(markup, /sr-only|aria-hidden="true"/);
  assert.match(markup, /aria-busy="false"/);
});
