import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { notificationToastModule } from "./helpers/notification-toast.ts";
import * as React from "react";
import { Streamdown } from "streamdown";
import * as markdown from "../lib/ai/response-markdown.ts";

const require = createRequire(import.meta.url);
const markdownExports = {} as typeof import("../components/ui/ai-markdown.tsx");
const markdownCode = ts.transpileModule(readFileSync(new URL("../components/ui/ai-markdown.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
vm.runInNewContext(markdownCode, { exports: markdownExports, require: (name: string) => {
  if (name === "streamdown") return { Streamdown };
  if (name === "@/lib/ai/response-markdown") return markdown;
  if (name === "@/components/ui/customer-research") return { SourceCitedText: ({ text }: { text: string }) => React.createElement("sup", { "data-citation": text }, text) };
  return require(name);
} });
test("a finished AI answer has one text copy for visual display, assistive technology and clipboard selection", () => {
  const source = readFileSync(new URL("../components/ui/ai-agent-response.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: { StreamingText?: (props: unknown) => unknown } = {};
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => {
    if (name === "react") return { useState: () => [0, () => {}], useEffect: () => {}, useEffectEvent: (fn: unknown) => fn, useSyncExternalStore: () => false };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "cn") return { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") };
    if (name === "@/components/ui/ai-markdown") return markdownExports;
    return {};
  })(name) });
  const text = "The catalog draft is ready for review.";
  const { renderToStaticMarkup } = require("react-dom/server");
  const markup = renderToStaticMarkup(exports.StreamingText!({ text, animate: false }));
  assert.equal(markup.split(text).length - 1, 1);
  assert.doesNotMatch(markup, /sr-only|aria-hidden="true"/);
  assert.match(markup, /aria-busy="false"/);
});

test("assistant Markdown renders formatting, tables, emoji and legacy record links", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const markup = renderToStaticMarkup(React.createElement(markdownExports.AiMarkdown, { text: "## Invoice review\n\n**No overdue invoices** ✅\n\n- **#1017** (/invoices/15693adc-0bdf-4617-b214-000000000001)\n\n| Status | Count |\n| --- | --- |\n| Draft | 8 |" }));
  assert.match(markup, /<strong>No overdue invoices<\/strong>/);
  assert.match(markup, /<table/);
  assert.match(markup, /<th/);
  assert.match(markup, /href="\/invoices\/15693adc/);
  assert.ok(markup.includes("✅"));
  assert.doesNotMatch(markup, /\*\*#1017\*\*/);
});

test("untrusted Markdown cannot emit active HTML, tracking images or executable links and retains citations", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const markup = renderToStaticMarkup(React.createElement(markdownExports.AiMarkdown, { text: '<script>alert(1)</script>\n\n<img src="https://bad.test/tracker" onerror="alert(1)">\n\n[Click](javascript:alert%281%29)\n\n![Track](https://bad.test/image)\n\nSaved source [W1]', sources: [{ id: "W1", label: "Verified source", url: "https://example.com/source" }] }));
  assert.doesNotMatch(markup, /<script|<img|javascript:|onerror=/);
  assert.match(markup, /data-citation="\[W1\]"/);
});
