import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { isStandaloneRoute } from "../lib/standalone-routes.ts";

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
    "@/components/app-loading": { AppLoading: () => null },
    "@/components/auth-skeleton": { AuthSkeleton: () => null },
    "@/lib/standalone-routes": { isStandaloneRoute },
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

test("auth and onboarding navigation never falls back to dashboard placeholders", () => {
  let pathname: string | null = null;
  const AppLoading = () => null;
  const AuthSkeleton = () => null;
  const { RouteLoadingSkeleton } = load("components/route-loading.tsx", {
    "next/navigation": { usePathname: () => pathname },
    "@/components/home-skeleton": { HomeSkeleton: () => { throw Error('Dashboard rendered during authentication'); } },
    "@/components/loading-skeletons": skeletons,
    "@/components/app-loading": { AppLoading },
    "@/components/auth-skeleton": { AuthSkeleton },
    "@/lib/standalone-routes": { isStandaloneRoute },
  });
  const render = RouteLoadingSkeleton as (props: Record<string, never>) => React.ReactElement<{ variant?: string; fields?: number }>;
  for (const [path, variant, fields] of [["/login", "signin", undefined], ["/login/", "signin", undefined], ["/signup", "signup", 5], ["/signup/", "signup", 5], ["/signup/verify", undefined, 1]] as const) {
    pathname = path;
    const element = render({});
    assert.equal(element.type, AuthSkeleton, path);
    assert.equal(element.props.variant, variant, path);
    assert.equal(element.props.fields, fields, path);
  }
  for (const path of [null, "/subscribe", "/subscribe/orders/test", "/workspaces/new", "/workspaces/setup", "/join/token", "/auth/mfa", "/forgot-password", "/update-password"]) {
    pathname = path;
    assert.equal(render({}).type, AppLoading, String(path));
  }
  for (const path of ["/login-other", "/signup-other", "/workspaces-other"]) {
    pathname = path;
    assert.equal(render({}).type, skeletons.PageLoadingSkeleton, path);
  }
});

test("the root layout shows a neutral loader while its account-dependent surface is suspended", () => {
  const { AppLoading } = load("components/app-loading.tsx");
  const { default: RootLayout } = load("app/layout.tsx", {
    "geist/font/sans": { GeistSans: { variable: "font-sans" } },
    "@/components/theme-provider": { ThemeProvider: React.Fragment },
    "@/components/ui/tooltip": { TooltipProvider: React.Fragment },
    "@/components/ui/sonner": { Toaster: () => null },
    "@/components/workspace-surface": { WorkspaceSurface: () => { throw new Promise(() => {}); } },
    "@/components/app-loading": { AppLoading },
    "@/components/language-provider": { LanguageProvider: React.Fragment },
    "@/components/site-monitoring": { SiteMonitoring: () => null },
    "@/components/workspace-error-boundary": { WorkspaceErrorBoundary: React.Fragment },
  });
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(RootLayout)));
  try {
    assert.ok(dom.window.document.querySelector('[role="status"][aria-label="Loading application"][aria-busy="true"]'));
    assert.equal(dom.window.document.querySelector('[aria-label="Loading page"], [data-slot="skeleton"], [data-workspace-shell]'), null);
  } finally { dom.window.close(); }
});
