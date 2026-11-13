import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import type { CustomerResearch } from "../lib/ai/customer-research.ts";
import * as citations from "../lib/ai/source-citations.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const require = createRequire(import.meta.url);
function renderComponent(name: string, props: unknown) {
  const code = ts.transpileModule(readFileSync(new URL("../components/ui/customer-research.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {} as Record<string, (props: unknown) => ReturnType<typeof import("react").createElement>>;
  vm.runInNewContext(code, { exports, URL, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => name === "@/components/language-provider" ? { useLanguage: () => ({ language: "en", t: (text: string) => text }) } : name === "@/lib/ai/source-citations" ? citations : require(name))(name) });
  return renderToStaticMarkup(exports[name](props));
}
const render = (research: Omit<CustomerResearch, "findings">) => renderComponent("CustomerResearchSources", { research });
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

test("answers render numbered publisher-icon citations and a native expandable source list", () => {
  const html = renderComponent("SourceCitedText", { text: "They sell printing materials [W1]. Their registry lists one location [W2].", sources: evidence.sources });
  assert.match(html, /aria-label="Source: Official \[W1\]"/);
  assert.match(html, /favicons\?domain=example.com/);
  assert.match(html, /favicons\?domain=registry.org/);
  assert.match(html, /They sell printing materials/);
  const list = renderComponent("SourceList", { sources: evidence.sources });
  assert.match(list, /<details/); assert.match(list, /<summary/);
  assert.match(list, /aria-label="Sources"/);
  assert.match(list, /Official/); assert.match(list, /registry.org/);
});

test("live research shows real sources and icons while the no-results state invents none", () => {
  const before = renderComponent("ResearchSearching", {});
  assert.match(before, /Preparing web research/);
  assert.match(before, /domain=google.com/);
  assert.doesNotMatch(before, /data-research-sources/);
  const live = renderComponent("ResearchSearching", { progress: { phase: "reading", sources: evidence.sources, queries: evidence.queries, visitedUrls: [] } });
  assert.match(live, /Reading company websites/);
  assert.match(live, /Sources found so far/);
  assert.match(live, /role="status"/);
  assert.match(live, /domain=registry.org/);
});

test("unknown citations and unsafe saved URLs cannot create clickable evidence", () => {
  const sources = [...evidence.sources, { id: "W9", label: "Unsafe", url: "javascript:alert(1)" }];
  const html = renderComponent("SourceCitedText", { text: "Known [W1], unknown [W99], unsafe [W9].", sources });
  assert.match(html, /unknown \[W99\]/); assert.match(html, /unsafe \[W9\]/);
  assert.doesNotMatch(html, /href="javascript|aria-label="Source: Unsafe/);
  assert.equal(citations.sourceDomain({ id: "W1", label: "motion.dev", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/a" }), "motion.dev");
});
