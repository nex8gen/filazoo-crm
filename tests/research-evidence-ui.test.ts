import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import type { CustomerResearch } from "../lib/ai/customer-research.ts";

const require = createRequire(import.meta.url);
function render(research: Omit<CustomerResearch, "findings">) {
  const code = ts.transpileModule(readFileSync(new URL("../components/ui/customer-research.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {} as { CustomerResearchSources: (props: unknown) => ReturnType<typeof import("react").createElement> };
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/language-provider" ? { useLanguage: () => ({ language: "en", t: (text: string) => text }) } : name === "lucide-react" ? { Globe: () => null } : require(name) });
  return renderToStaticMarkup(exports.CustomerResearchSources({ research }));
}
const evidence = { status: "complete" as const, checkedAt: "2026-11-06T04:00:00Z", queries: ["Example Print Boston", "Example Print official website"], visitedUrls: ["https://example.com/about", "https://registry.org/business"], sources: [{ id: "W1", label: "Official", url: "https://example.com/about", recordedAt: "now" }, { id: "W2", label: "Registry", url: "https://registry.org/business", recordedAt: "now" }] };
test("research reply shows actual Google queries, pages read and clickable citations", () => {
  const html = render(evidence);
  assert.match(html, /Google search queries.*\(2\)/); assert.match(html, /Pages read.*\(2\)/);
  assert.match(html, /Example Print Boston/); assert.match(html, /href="https:\/\/example.com\/about"/);
  assert.match(html, /href="https:\/\/registry.org\/business"/); assert.match(html, /rel="noopener noreferrer"/);
});
test("saved legacy replies and partial research never invent page visits", () => {
  const html = render({ ...evidence, visitedUrls: undefined, warning: "Website reading could not finish." });
  assert.doesNotMatch(html, /Pages read/); assert.match(html, /Website reading could not finish/);
  assert.match(html, /role="status"/);
});
