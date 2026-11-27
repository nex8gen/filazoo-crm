import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { workspaceIdSchema } from "../lib/workspaces.ts";
import { currentWorkspaceContext, withWorkspaceContext } from "../lib/workspace-context.ts";
import * as designTools from "../lib/portal-design.ts";
import * as websiteTools from "../lib/portal-website-design.ts";
import { isStandaloneRoute } from "../lib/standalone-routes.ts";

const require = createRequire(import.meta.url);
const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
function load<T>(file: string, dependencies: Record<string, unknown>) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, Headers, Date, process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture" } }, require: (name: string) => dependencies[name] ?? require(name) });
  return exports as T;
}

test("public website reader only returns the requested workspace's publication and excludes private data", async () => {
  const a = designTools.defaultPortalDesign("Public A");
  a.heading = "PRIVATE ACCOUNT SETTINGS";
  a.website = websiteTools.portalWebsiteDesign(a);
  a.website.pages[1].enabled = false;
  a.website.pages[1].sections[0].body = "HIDDEN WEBSITE PAGE";
  const records = new Map<string, unknown>([[tenantA, a], [tenantB, designTools.defaultPortalDesign("Public B")]]);
  const reads: string[] = [];
  let fail = false;
  const { getPublicWebsite, workspaceWebsitePath } = load<{
    getPublicWebsite: (id: string) => Promise<websiteTools.PublicWebsiteDesign | null>;
    workspaceWebsitePath: (id: string) => Promise<string | undefined>;
  }>("lib/data/public-website.ts", {
    "server-only": {}, "../workspaces": { workspaceIdSchema }, "../portal-design": designTools, "../portal-website-design": websiteTools,
    "../workspace-context": { withWorkspaceContext },
    "../supabase/control": { createSupabaseControl: () => { throw new Error("Public requests must never read workspace identities"); } },
    "../supabase/admin": { createSupabaseAdmin: () => ({ from: (table: string) => {
      assert.equal(table, "workspace_portal_designs");
      const workspace = currentWorkspaceContext()!.workspaceId;
      let filtered = "";
      const chain = { select: (fields: string) => { assert.equal(fields, "published"); return chain; }, eq: (key: string, value: unknown) => { if (key === "workspace_id") filtered = String(value); else { assert.equal(key, "singleton"); assert.equal(value, true); } return chain; }, maybeSingle: async () => {
        await Promise.resolve(); assert.equal(filtered, workspace); reads.push(workspace);
        return { data: records.has(workspace) ? { published: records.get(workspace) } : null, error: fail ? { message: "Database unavailable" } : null };
      } };
      return chain;
    } }) },
  });
  const [first, second] = await Promise.all([getPublicWebsite(tenantA), getPublicWebsite(tenantB)]);
  assert.equal(first?.brandName, "Public A"); assert.equal(second?.brandName, "Public B");
  assert.equal(JSON.stringify(first).includes("PRIVATE ACCOUNT SETTINGS"), false);
  assert.equal(JSON.stringify(first).includes("HIDDEN WEBSITE PAGE"), false);
  assert.equal("sections" in first!, false); assert.equal("features" in first!, false);
  assert.deepEqual(reads.sort(), [tenantA, tenantB]);
  assert.equal(await workspaceWebsitePath(tenantA), `/website/${tenantA}`);
  assert.equal(await getPublicWebsite("invalid"), null); assert.equal(reads.length, 2);
  records.set(tenantA, null); assert.equal(await getPublicWebsite(tenantA), null);
  records.set(tenantA, { invalid: true }); assert.equal(await getPublicWebsite(tenantA), null);
  records.delete(tenantA); assert.equal(await getPublicWebsite(tenantA), null);
  fail = true; await assert.rejects(getPublicWebsite(tenantB), /Unable to load/);
});

test("public website pages reject unpublished, hidden and invalid pages while account access stays private", async () => {
  const design = designTools.defaultPortalDesign("Public website");
  design.website = websiteTools.portalWebsiteDesign(design);
  design.website.pages[1].enabled = false;
  let published = true;
  let reads = 0;
  const { PublicWebsitePage } = load<{ PublicWebsitePage: (props: { params: Promise<{ workspaceId: string; page?: string[] }> }) => Promise<{ type: unknown; props: { basePath?: string; design?: unknown } }> }>("components/public-website-page.tsx", {
    "next/server": { connection: async () => {} }, "next/navigation": { notFound: () => { throw new Error("not-found"); } },
    "@/lib/data/public-website": { getPublicWebsite: async (id: string) => { assert.equal(id, tenantA); reads++; return published ? websiteTools.publicWebsiteDesign(design) : null; } },
    "@/lib/portal-website-design": websiteTools, "@/components/portal-website": { PortalWebsite: "public-website" },
  });
  const visit = (page?: string[]) => PublicWebsitePage({ params: Promise.resolve({ workspaceId: tenantA, page }) });
  const home = await visit(); assert.equal(home.type, "public-website"); assert.equal(home.props.basePath, `/website/${tenantA}`);
  assert.equal((await visit(["pages", "contact"])).type, "public-website");
  await assert.rejects(visit(["pages", "about"]), /not-found/);
  await assert.rejects(visit(["pages", "missing"]), /not-found/);
  const before = reads; await assert.rejects(visit(["invoices", "anything"]), /not-found/); assert.equal(reads, before);
  assert.equal((await visit(["account"])).type, "main");
  published = false; await assert.rejects(visit(), /not-found/);
});

test("signed-out public websites bypass staff auth and receive a trusted marker and no-store headers", async () => {
  const { NextRequest, NextResponse } = require("next/server");
  let authReads = 0;
  const { updateSession } = load<{ updateSession: (request: Request) => Promise<Response> }>("lib/supabase/proxy.ts", {
    "next/server": { NextResponse }, "./auth-fetch.ts": { authFetch: () => fetch }, "./auth-error.ts": { isTransientAuthError: () => false },
    "../workspace-session-response.ts": { workspaceSessionUnavailableResponse: () => { throw new Error("unexpected"); } },
    "@supabase/ssr": { createServerClient: () => ({ auth: { getClaims: async () => { authReads++; return { data: { claims: { sub: "staff" } } }; } } }) },
  });
  for (const path of [`/website/${tenantA}`, `/website/${tenantA}/pages/contact`]) {
    const response = await updateSession(new NextRequest(`https://crm.test${path}`));
    assert.equal(response.status, 200); assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-request-x-filazoo-public-website"), "1");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(isStandaloneRoute(path), true);
  }
  assert.equal(authReads, 0);
  const staff = await updateSession(new NextRequest("https://crm.test/companies", { headers: { "x-filazoo-public-website": "1" } }));
  assert.equal(authReads, 1); assert.equal(staff.headers.get("x-middleware-request-x-filazoo-public-website"), null);
  assert.equal(isStandaloneRoute("/website-settings"), false);
});
