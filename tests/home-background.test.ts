import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isCompanyProfilePath } from "../lib/company-tabs.ts";

type Element = { props?: Record<string, unknown> & { children?: Element | Element[] } };

function frame(tree: Element): Element | undefined {
  if (String(tree.props?.className).startsWith("workspace-page ")) return tree;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    if (child && typeof child === "object") {
      const found = frame(child as Element);
      if (found) return found;
    }
  }
}

test("Home backdrop follows the active route even when cached Home children remain mounted", () => {
  let pathname = "/";
  let companySegment: string | null = null;
  let segments: string[] = [];
  const noop = () => null;
  const react = {
    lazy: noop, Suspense: noop, useCallback: (callback: unknown) => callback,
    useEffect: noop, useRef: () => ({ current: null }),
    useState: (initial: unknown) => [initial, noop],
  };
  const jsx = (_type: unknown, props: Element["props"]) => ({ props });
  const dependencies: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/dynamic": { default: noop },
    "next/navigation": {
      usePathname: () => pathname, useRouter: () => ({}),
      useSelectedLayoutSegment: () => companySegment,
      useSelectedLayoutSegments: () => segments,
    },
    "@/lib/navigation": { navigation: [] },
    "@/lib/company-tabs": { isCompanyProfilePath },
    "@/lib/standalone-routes": { isStandaloneRoute: () => false },
    "@/components/workspace-sidebar": { useWorkspaceSidebar: () => ({ expanded: false, isDesktop: true }) },
  };
  const exports = {} as { AppShell: (props: { children: Element }) => Element };
  const code = ts.transpileModule(readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? new Proxy({}, { get: () => noop }) });
  // React Activity retains this hidden Home tree while other routes are active.
  const cachedHome = { props: { className: "home-workspace", style: { display: "none" } } };
  for (const path of ["/", "/workflow", "/email", "/companies", "/settings", "/"]) {
    pathname = path;
    const page = frame(exports.AppShell({ children: cachedHome }));
    assert.ok(page);
    assert.equal(page.props?.["data-home"], path === "/" ? true : undefined, path);
  }
  pathname = "/companies/customer-id";
  companySegment = "(.)companies";
  for (const background of [[], ["companies"]]) {
    segments = background;
    assert.equal(frame(exports.AppShell({ children: cachedHome }))?.props?.["data-home"], background.length ? undefined : true,
      "intercepted profiles must use the originating page's backdrop");
  }
  companySegment = "companies";
  segments = ["companies", "customer-id"];
  assert.equal(frame(exports.AppShell({ children: cachedHome }))?.props?.["data-home"], undefined,
    "reloaded profiles must use the company list's backdrop");
  pathname = "/";
  assert.equal(frame(exports.AppShell({ children: cachedHome }))?.props?.["data-home"], true,
    "a retained company segment cannot override the actual page after closing");
});
