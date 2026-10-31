import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../lib/crm-model.ts";
import * as portraits from "../lib/company-avatar.ts";

test("mixed lead sources preserve acquisition order and expose both channels", () => {
  assert.deepEqual(model.companySourcePresentation("meta_lead_ads+shopify_b2b_form"), { label: "Meta + Shopify B2B", icon: "meta", count: 2 });
  assert.deepEqual(model.companySourcePresentation("shopify_b2b_form+meta_lead_ads"), { label: "Shopify B2B + Meta", icon: "shopify", count: 2 });
  assert.deepEqual(model.companySourcePresentation("manual+shopify_b2b_form"), { label: "Manual + Shopify B2B", icon: null, count: 2 });
});

test("source display handles aliases, duplicates, case, missing and unknown sources", () => {
  for (const source of ["meta_lead_ads", "facebook", "messenger", "instagram"]) {
    assert.deepEqual(model.companySourcePresentation(source), { label: "Meta", icon: "meta", count: 1 });
  }
  assert.deepEqual(model.companySourcePresentation(" + META_lead_ads + facebook + Shopify_B2B_form + shopify +"), { label: "Meta + Shopify B2B", icon: "meta", count: 2 });
  for (const source of [null, undefined, "", " + "]) assert.deepEqual(model.companySourcePresentation(source), { label: "Imported", icon: null, count: 0 });
  assert.deepEqual(model.companySourcePresentation("historical_personal_email"), { label: "historical personal email", icon: null, count: 1 });
  assert.equal(model.companySourcePresentation("not_shopify+metadata_import").icon, null);
});

test("company avatars render the original source icon and complete accessible history", () => {
  const require = createRequire(import.meta.url);
  const exports: Record<string, (props: Record<string, unknown>) => unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/company-avatar.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => id === "@/lib/crm-model" ? model : id === "@/lib/company-avatar" ? portraits : require(id) });
  const { renderToStaticMarkup } = require("react-dom/server");
  const company = { id: "4bed93d7-8534-4af3-bf19-f8810171808d", name: "Campgirl Clothing Co.", source: "meta_lead_ads+shopify_b2b_form", sourceLabel: "Shopify B2B" };
  for (const [source, icon, title] of [
    [company.source, "meta", "Lead sources: Meta + Shopify B2B"],
    ["shopify_b2b_form+meta_lead_ads", "shopify", "Lead sources: Shopify B2B + Meta"],
    ["shopify_b2b_form", "shopify", "Lead source: Shopify B2B"],
    ["meta_lead_ads", "meta", "Lead source: Meta"],
  ]) {
    const html = renderToStaticMarkup(exports.CompanyAvatar({ company: { ...company, source } }));
    assert.ok(html.includes(`src="/${icon}-mark.svg"`), html);
    assert.ok(html.includes(`aria-label="${title}"`));
    assert.ok(html.includes(`title="${title}"`));
    assert.ok(!html.includes(`src="/${icon === "meta" ? "shopify" : "meta"}-mark.svg"`));
  }
  const manual = renderToStaticMarkup(exports.CompanyAvatar({ company: { ...company, source: "manual" } }));
  assert.ok(!manual.includes("-mark.svg"));
  const custom = renderToStaticMarkup(exports.CompanyAvatar({ company, badge: "!", badgeLabel: "Custom badge" }));
  assert.ok(custom.includes('aria-label="Custom badge"'));
  assert.ok(!custom.includes("-mark.svg"));
});
