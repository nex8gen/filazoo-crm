import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file: string, dependencies: Record<string, unknown> = {}) {
  const exports: Record<string, React.ComponentType> = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => name.endsWith(".css") ? {} : dependencies[name] ?? require(name) });
  return exports;
}
const controls = load("components/ui/skeleton.tsx");
const regions = load("components/page-skeletons.tsx", { "@/components/ui/skeleton": controls, "@/components/page-header": { PageActions: React.Fragment } });
const skeletons = load("components/loading-skeletons.tsx", { "@/components/ui/skeleton": controls, "@/components/page-skeletons": regions });

test("loading screens use shared skeletons without logo graphics and the editor keeps its three panels", () => {
  for (const name of ["PageLoadingSkeleton", "WebsiteLoadingSkeleton", "PortalEditorSkeleton"]) {
    const dom = new JSDOM(renderToStaticMarkup(React.createElement(skeletons[name])));
    try {
      const document = dom.window.document;
      assert.ok(document.querySelector('[role="status"][aria-busy="true"]'));
      assert.ok(document.querySelectorAll('[data-slot="skeleton"]').length >= 10);
      assert.equal(document.querySelector("svg, img"), null);
      if (name === "PortalEditorSkeleton") {
        for (const selector of [".pb-topbar", ".pb-structure", ".pb-preview", ".pb-editor"]) assert.ok(document.querySelector(selector), selector);
      }
    } finally { dom.window.close(); }
  }
});

test("theme editor navigation uses its layout skeleton and unrelated pages keep their own loading style", () => {
  let pathname = "/customer-portal/themes/current";
  const HomeSkeleton = () => null;
  const { RouteLoadingSkeleton } = load("components/route-loading.tsx", {
    "next/navigation": { usePathname: () => pathname },
    "@/components/home-skeleton": { HomeSkeleton },
    "@/components/loading-skeletons": skeletons,
  });
  for (const [path, expected] of [
    ["/customer-portal/themes/current", skeletons.PortalEditorSkeleton],
    ["/customer/domain", skeletons.WebsiteLoadingSkeleton],
    ["/", HomeSkeleton],
    ["/companies", skeletons.PageLoadingSkeleton],
  ] as const) {
    pathname = path;
    const render = RouteLoadingSkeleton as (props: Record<string, never>) => React.ReactElement;
    assert.equal(render({}).type, expected, path);
  }
});
