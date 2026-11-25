import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { defaultPortalDesign, portalDesignSchema } from "../lib/portal-design.ts";
import * as website from "../lib/portal-website-design.ts";

test("old themes retain private account content and gain independently editable website pages", () => {
  const design = defaultPortalDesign();
  design.heading = "Private account heading";
  const site = website.portalWebsiteDesign(design);
  assert.deepEqual(site.pages.map(page => page.id), ["home", "about", "contact"]);
  assert.equal(design.website, undefined);
  assert.equal(design.heading, "Private account heading");
  assert.equal(portalDesignSchema.safeParse({ ...design, website: site }).success, true);
  assert.equal(website.portalWebsiteHref("home"), "/");
  assert.equal(website.portalWebsiteHref("pages/about"), "/pages/about");
  assert.equal(website.portalWebsiteHref("account"), "/account");
  const publicDesign = website.publicWebsiteDesign(design);
  assert.equal(JSON.stringify(publicDesign).includes("Private account heading"), false);
  assert.equal("sections" in publicDesign, false);
  assert.equal("features" in publicDesign, false);
  design.website = site;
  design.website.pages[1].enabled = false;
  design.website.pages[1].sections[0].body = "Hidden website page content";
  design.website.pages[0].sections[0].enabled = false;
  design.website.pages[0].sections[0].body = "Hidden hero content";
  const publicContent = JSON.stringify(website.publicWebsiteDesign(design));
  assert.equal(publicContent.includes("Hidden website page content"), false);
  assert.equal(publicContent.includes("Hidden hero content"), false);
});

test("website validation protects page identities and only permits secure images and internal buttons", () => {
  const design = defaultPortalDesign();
  design.website = website.portalWebsiteDesign(design);
  const valid = () => structuredClone(design);
  for (const imageUrl of ["javascript:alert(1)", "data:image/svg+xml,test", "http://example.com/image.png"]) {
    const input = valid(); input.website!.pages[0].sections[0].imageUrl = imageUrl;
    assert.equal(portalDesignSchema.safeParse(input).success, false);
  }
  for (const change of [
    (input: typeof design) => { input.website!.pages[0].enabled = false; },
    (input: typeof design) => { input.website!.pages[1].id = "home"; },
    (input: typeof design) => { input.website!.pages[1].id = "account"; },
    (input: typeof design) => { input.website!.pages[0].sections[0].buttonPage = "https://example.com"; },
    (input: typeof design) => { input.website!.pages[0].sections[0].height = 99999; },
    (input: typeof design) => { input.website!.pages[0].sections.push(input.website!.pages[0].sections[0]); },
  ]) { const input = valid(); change(input); assert.equal(portalDesignSchema.safeParse(input).success, false); }
});

test("domain website rendering never reads customer sessions and account access remains tenant scoped", async () => {
  let cookiesRead = 0;
  let sessionReads = 0;
  let token: string | undefined = undefined;
  let validSession = false;
  const filters: [string, unknown][] = [];
  const design = defaultPortalDesign();
  design.heading = "Private account heading";
  const require = createRequire(import.meta.url);
  const deps: Record<string, unknown> = {
    "next/headers": { headers: async () => new Headers({ host: "portal.example.com" }), cookies: async () => { cookiesRead++; return { get: () => token ? { value: token } : undefined }; } },
    "next/navigation": { notFound: () => { throw new Error("not-found"); }, redirect: (url: string) => { throw new Error(`redirect:${url}`); } },
    "@/lib/data/portal-domain-routing": { findPortalDomain: async () => ({ workspace_id: "tenant-a", status: "connected" }) },
    "@/lib/workspace-context": { withWorkspaceContext: async (id: string, work: () => unknown) => { assert.equal(id, "tenant-a"); return work(); } },
    "@/lib/data/portal-design": { getPublishedPortalDesign: async () => design },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ from: () => {
      sessionReads++;
      const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; }, gt: () => chain, maybeSingle: async () => ({ data: validSession ? { invoice_id: "invoice-a" } : null, error: null }) };
      return chain;
    } }) },
    "@/lib/data/customer-portal": { portalCookie: "session" },
    "@/lib/customer-portal-crypto": { portalHash: () => "hashed-token" },
    "@/lib/portal-domains": { portalRequestHost: (host: string) => host },
    "@/lib/portal-website-design": website,
    "@/components/portal-website": { PortalWebsite: "website" },
  };
  const exports = {} as { PortalDomainPage: (props: { page?: string }) => Promise<{ props: { design: unknown } }> };
  const code = ts.transpileModule(readFileSync("components/portal-domain-page.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, Date, require: (name: string) => deps[name] ?? require(name) });
  for (const page of ["home", "pages/about", "pages/contact"]) {
    const result = await exports.PortalDomainPage({ page });
    assert.equal(JSON.stringify(result.props.design).includes("Private account heading"), false);
  }
  assert.equal(cookiesRead, 0); assert.equal(sessionReads, 0);
  await assert.rejects(exports.PortalDomainPage({ page: "pages/missing" }), /not-found/);
  await exports.PortalDomainPage({ page: "account" });
  assert.equal(cookiesRead, 1); assert.equal(sessionReads, 0);
  token = "a".repeat(43); validSession = true;
  await assert.rejects(exports.PortalDomainPage({ page: "account" }), /redirect:\/customer\/invoices\/invoice-a/);
  assert.equal(sessionReads, 1);
  assert.deepEqual(filters, [["workspace_id", "tenant-a"], ["token_hash", "hashed-token"]]);
  design.website = website.portalWebsiteDesign(design);
  design.website.pages.find(page => page.id === "about")!.enabled = false;
  await assert.rejects(exports.PortalDomainPage({ page: "pages/about" }), /not-found/);
});

test("custom website domains bypass the staff shell even when their visible URL is the home page", async () => {
  const require = createRequire(import.meta.url);
  let hostname = "portal.example.com";
  const dependencies: Record<string, unknown> = {
    "next/headers": { headers: async () => new Headers({ host: hostname }) },
    "@/lib/portal-domains": { portalRequestHost: (host: string) => host, isPlatformHost: (host: string) => ["localhost", "crm.filazoosupply.com"].includes(host) },
    "@/components/account-preferences": { AccountPreferences: "preferences" },
    "@/components/app-shell": { AppShell: "staff-shell" },
    "@/components/user-menu": { UserMenu: "staff-user-menu" },
  };
  const exports = {} as { WorkspaceSurface: (props: { children: string }) => Promise<string | { type: string }> };
  const code = ts.transpileModule(readFileSync("components/workspace-surface.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name) });
  assert.equal(await exports.WorkspaceSurface({ children: "public website" }), "public website");
  hostname = "crm.filazoosupply.com";
  assert.equal((await exports.WorkspaceSurface({ children: "CRM page" }) as { type: string }).type, "preferences");
});
