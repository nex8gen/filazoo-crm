import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { ReactElement } from "react";
import { isCompanyProfilePath } from "../lib/company-tabs.ts";

const require = createRequire(import.meta.url);
const CompaniesPage = () => null;
const CompanyPage = () => null;
const CompanyProfileSheet = () => null;

function route(file: string, segment = "companies", pathname = "/companies/acme") {
  const exports = {} as { default: (props: { children: string }) => ReactElement<{ children: string; closeHref?: string }> | null };
  const dependencies: Record<string, unknown> = {
    "../page": { default: CompaniesPage },
    "@/components/company-page": { default: CompanyPage },
    "@/components/company-profile-sheet": { CompanyProfileSheet },
    "next/navigation": { useSelectedLayoutSegment: () => segment, usePathname: () => pathname },
    "@/lib/company-tabs": { isCompanyProfilePath },
  };
  const code = ts.transpileModule(readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name) });
  return exports.default;
}

test("reloading a company URL renders the company list with the shared profile in its drawer slot", () => {
  assert.equal(route("companies/[id]/page.tsx"), CompaniesPage);
  assert.equal(route("@company/companies/[id]/page.tsx"), CompanyPage);
  assert.equal(route("@company/(.)companies/[id]/page.tsx"), CompanyPage);
  const drawer = route("@company/layout.tsx")({ children: "Selected company tab" })!;
  assert.equal(drawer.type, CompanyProfileSheet);
  assert.equal(drawer.props.children, "Selected company tab");
  assert.equal(drawer.props.closeHref, "/companies");
});

test("profiles opened within the app retain back navigation, and leaving a company URL clears the drawer", () => {
  const drawer = route("@company/layout.tsx", "(.)companies")({ children: "Profile" })!;
  assert.equal(drawer.type, CompanyProfileSheet);
  assert.equal(drawer.props.closeHref, undefined);
  assert.equal(route("@company/[...catchAll]/page.tsx")({ children: "" }), null);
});

test("the company list and other pages never render a retained profile slot", () => {
  for (const pathname of ["/companies", "/companies/", "/", "/email", "/settings", "/companies/acme/other"]) {
    for (const segment of ["companies", "(.)companies", "catchAll"]) {
      assert.equal(route("@company/layout.tsx", segment, pathname)({ children: "Retained profile content" }), null, `${pathname}: ${segment}`);
    }
  }
});
