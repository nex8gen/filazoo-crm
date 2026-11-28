import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import { isMarketingHost, MARKETING_APP_ORIGIN, MARKETING_ORIGIN } from "../lib/marketing.ts";
import { isPlatformHost, portalRequestHost } from "../lib/portal-domains.ts";

const require = createRequire(import.meta.url);
function fixture() {
  const calls = { session: 0, portal: 0 };
  const exports: { proxy?: (request: NextRequest) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    "@/lib/marketing": { isMarketingHost, MARKETING_APP_ORIGIN, MARKETING_ORIGIN },
    "@/lib/portal-domains": { isPlatformHost: (host: string) => isPlatformHost(host, {}), portalRequestHost },
    "@/lib/supabase/proxy": { updateSession: async (request: NextRequest) => { calls.session++; return NextResponse.next({ request: { headers: request.headers } }); } },
    "@/lib/data/portal-domain-routing": { findPortalDomain: async () => { calls.portal++; return null; } },
  };
  const code = ts.transpileModule(readFileSync("proxy.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), URL, Headers, process: { env: { NODE_ENV: "production" } } });
  return { calls, proxy: exports.proxy! };
}
function request(host: string, pathname = "/", headers: Record<string, string> = {}) {
  return new NextRequest(`https://${host}${pathname}`, { headers: { host, ...headers } });
}

test("www renders public marketing without session or customer data reads", async () => {
  const { calls, proxy } = fixture();
  const response = await proxy(request("www.newai.xin", "/?utm_source=launch"));
  const target = new URL(response.headers.get("x-middleware-rewrite")!);
  assert.equal(target.pathname, "/marketing");
  assert.equal(target.search, "?utm_source=launch");
  assert.equal(response.headers.get("x-middleware-request-x-newai-marketing"), "1");
  assert.deepEqual(calls, { session: 0, portal: 0 });
});

test("apex canonicalizes to www and account links use the application origin", async () => {
  const { proxy } = fixture();
  const apex = await proxy(request("newai.xin", "/?utm_source=direct"));
  assert.equal(apex.status, 308);
  assert.equal(apex.headers.get("location"), "https://www.newai.xin/?utm_source=direct");
  const login = await proxy(request("www.newai.xin", "/login?next=%2Fcompanies"));
  assert.equal(login.headers.get("location"), "https://app.newai.xin/login?next=%2Fcompanies");
  const duplicate = await proxy(request("www.newai.xin", "/marketing"));
  assert.equal(duplicate.status, 308);
  assert.equal(duplicate.headers.get("location"), "https://www.newai.xin/");
});

test("marketing SEO routes work without authentication, unknown pages and APIs fail closed", async () => {
  const { calls, proxy } = fixture();
  const robots = await proxy(request("www.newai.xin", "/robots.txt"));
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Sitemap: https:\/\/www\.newai\.xin\/sitemap\.xml/);
  const sitemap = await proxy(request("www.newai.xin", "/sitemap.xml"));
  assert.match(await sitemap.text(), /<loc>https:\/\/www\.newai\.xin\/<\/loc>/);
  for (const path of ["/companies", "/api/ai/assistant", "/marketing/private"]) {
    const response = await proxy(request("www.newai.xin", path));
    assert.equal(response.status, 404);
  }
  assert.deepEqual(calls, { session: 0, portal: 0 });
});

test("marketing preview is public only on platform hosts and cannot bypass CRM authentication", async () => {
  const { calls, proxy } = fixture();
  const preview = await proxy(request("localhost:3000", "/marketing"));
  assert.equal(preview.headers.get("x-middleware-request-x-newai-marketing"), "1");
  assert.equal(calls.session, 0);
  const crm = await proxy(request("app.newai.xin", "/companies", { "x-newai-marketing": "1" }));
  assert.equal(calls.session, 1);
  assert.equal(crm.headers.get("x-middleware-request-x-newai-marketing"), null);
  const portal = await proxy(request("customer.example.com", "/marketing", { "x-newai-marketing": "1" }));
  assert.equal(portal.status, 404);
  assert.equal(calls.portal, 1);
});

test("only exact NewAI domains are reserved as platform hosts", () => {
  for (const host of ["www.newai.xin", "newai.xin", "app.newai.xin"]) assert.equal(isPlatformHost(host, {}), true);
  for (const host of ["newai.xin.example.com", "customer.newai.xin", "www-newai.xin"]) assert.equal(isMarketingHost(host), false);
});

test("static CRM demos are public and cannot execute scripts, connect to APIs, or submit forms", async () => {
  const { calls, proxy } = fixture();
  for (const host of ["www.newai.xin", "app.newai.xin"]) {
    for (const view of ["home", "email", "workflow", "orders"]) {
      const response = await proxy(request(host, `/marketing/crm-demo/${view}.html`));
      assert.equal(response.status, 200);
      const policy = response.headers.get("Content-Security-Policy")!;
      for (const rule of ["script-src 'none'", "connect-src 'none'", "form-action 'none'", "sandbox allow-same-origin"]) assert.ok(policy.includes(rule));
      assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
    }
  }
  for (const path of ["/marketing/crm-demo/private.html", "/marketing/demo-source"]) assert.equal((await proxy(request("www.newai.xin", path))).status, 404);
  assert.deepEqual(calls, { session: 0, portal: 0 });
});
