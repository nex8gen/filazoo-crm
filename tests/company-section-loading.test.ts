import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => dependencies[name] ?? require(name) });
  return exports as T;
}
const skeletons = load<typeof import("../components/company-section-skeleton.tsx")>("components/company-section-skeleton.tsx", {
  "@/components/ui/skeleton": { Skeleton: (props: React.ComponentProps<"div">) => React.createElement("div", { "data-slot": "skeleton", ...props }) },
  "@/components/workspace-skeletons": { CompanyBillingSkeleton: () => React.createElement("div", { role: "status", "aria-label": "Loading customer billing" }) },
});

for (const [tab, label, part] of [
  ["analyse", "Loading purchase analysis", "charts"],
  ["customer-portal", "Loading customer portal", "portal"],
  ["history", "Loading activity history", "timeline"],
] as const) test(`${tab} loads its own accessible content shape`, () => {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(skeletons.CompanySectionSkeleton, { tab })));
  const region = dom.window.document.querySelector('[role="status"]')!;
  assert.equal(region.getAttribute("aria-label"), label);
  assert.equal(region.getAttribute("aria-busy"), "true");
  assert.equal(region.getAttribute("data-company-loading"), tab);
  assert.ok(region.querySelector(`[data-loading-part="${part}"]`));
  assert.equal(region.querySelectorAll("input, button, a, select, textarea").length, 0, "loading controls cannot be accidentally submitted");
  assert.ok(!region.textContent!.includes("customer billing"));
});

test("dynamic code loading reuses the same per-tab skeleton as server streaming", () => {
  const views = load<Record<string, React.ComponentType>>("components/company-section-views.tsx", {
    "next/dynamic": { default: (_loader: unknown, options: { loading: React.ComponentType }) => options.loading },
    "@/components/company-section-skeleton": skeletons,
  });
  for (const [name, tab] of [["CompanyAnalysisDashboard", "analyse"], ["CompanyPortalWorkspace", "customer-portal"], ["EmailInboxWorkspace", "email"]]) {
    const dom = new JSDOM(renderToStaticMarkup(React.createElement(views[name])));
    assert.equal(dom.window.document.querySelector('[role="status"]')?.getAttribute("data-company-loading"), tab);
  }
});
