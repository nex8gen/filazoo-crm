import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest } from "next/server.js";
import * as domains from "../lib/portal-domains.ts";

const require = createRequire(import.meta.url);
function load<T>(file: string, deps: Record<string, unknown>, env: Record<string, string> = {}, globals: Record<string, unknown> = {}): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : deps[name] ?? require(name), process: { env }, URL, Response, Request, AbortSignal, console, ...globals });
  return exports as T;
}

test("domain input normalizes IDNs and rejects URLs, unsafe hosts and private suffixes", () => {
  assert.equal(domains.normalizePortalDomain(" PORTAL.Example.com. "), "portal.example.com");
  assert.equal(domains.normalizePortalDomain("bücher.de"), "xn--bcher-kva.de");
  for (const value of ["", "localhost", "127.0.0.1", "[::1]", "https://example.com", "user@example.com", "example.com:443", "example.com/path", "*.example.com", "foo..com", "-foo.com", "foo-.com", "foo.com?x=y", "foo.com\\admin", "foo.vercel.app", "foo.supabase.co", "foo.github.io", "com", "internal.invalid", "foo%2ecom"]) assert.throws(() => domains.normalizePortalDomain(value), undefined, value);
  assert.equal(domains.isPlatformHost("crm.filazoosupply.com", {}), true);
  assert.equal(domains.isPlatformHost("unrelated.vercel.app", {}), false);
  assert.equal(domains.isPlatformHost("deploy-123.vercel.app", { VERCEL_URL: "deploy-123.vercel.app" }), true);
});

test("routing records use current provider recommendations and TLS probes exclude private destinations", () => {
  const config = { misconfigured: true, recommendedCNAME: [{ rank: 2, value: "old.example.net." }, { rank: 1, value: "tenant.vercel-dns-017.com." }], recommendedIPv4: [{ rank: 1, value: ["216.150.1.1", "216.150.16.1"] }] };
  assert.deepEqual(domains.domainRoutingRecords("portal.example.com", config), [{ type: "CNAME", name: "portal.example.com", value: "tenant.vercel-dns-017.com" }]);
  assert.deepEqual(domains.domainRoutingRecords("example.com", config), [{ type: "A", name: "example.com", value: "216.150.1.1" }]);
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.31.0.1", "192.168.1.1", "100.64.1.1", "198.19.1.1", "0.0.0.0", "224.0.0.1", "203.0.113.1", "::1", "::ffff:127.0.0.1", "999.1.1.1"]) assert.equal(domains.publicPortalAddress(ip), false, ip);
  assert.equal(domains.publicPortalAddress("216.150.1.1"), true);
});

type Row = Record<string, unknown>;
function fixture() {
  const state = { row: null as Row | null, owns: false, certificate: false, attached: false, providerVerified: true, dnsReady: true, removalFails: false, addresses: ["216.150.1.1"], tlsCalls: 0, barrier: null as Promise<void> | null, calls: [] as string[] };
  const db = { from(name: string) {
    assert.equal(name, "workspace_portal_domains");
    let operation = "read", patch: Row = {}, lease = false;
    const filters: [string, unknown][] = [];
    const matches = () => state.row && filters.every(([key, value]) => state.row?.[key] === value) && (!lease || !state.row.operation_until || Date.parse(String(state.row.operation_until)) < Date.now());
    const result = () => {
      if (operation === "insert") {
        if (state.row) return { data: null, error: { code: "23505" } };
        state.row = { status: "pending_dns", provider_added: false, checked_at: null, message: null, operation_token: null, operation_until: null, ...structuredClone(patch) };
      } else if (!matches()) return { data: null, error: null };
      else if (operation === "update") Object.assign(state.row!, structuredClone(patch));
      else if (operation === "delete") state.row = null;
      return { data: structuredClone(state.row), error: null };
    };
    const query = {
      select() { return query; }, insert(value: Row) { operation = "insert"; patch = value; return query; }, update(value: Row) { operation = "update"; patch = value; return query; }, delete() { operation = "delete"; return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; }, or() { lease = true; return query; },
      async single() { return result(); }, async maybeSingle() { return result(); }, then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    }; return query;
  } };
  class Resolver {
    async resolveTxt() { if (state.barrier) await state.barrier; return state.owns ? [[domains.domainOwnershipRecord("portal.example.com", String(state.row?.verification_token)).value]] : []; }
    async resolve4() { return state.addresses; }
  }
  const providerDomain = () => ({ name: "portal.example.com", verified: state.providerVerified, verification: state.providerVerified ? [] : [{ type: "TXT", domain: "_vercel.example.com", value: "vc-challenge" }] });
  const provider = {
    portalDomainHostingReady: () => true,
    getProviderDomain: async () => { state.calls.push("get"); return state.attached ? providerDomain() : null; },
    getProviderConfig: async () => ({ misconfigured: !state.dnsReady, recommendedCNAME: [{ rank: 1, value: "tenant.vercel-dns-017.com." }] }),
    addProviderDomain: async () => { state.calls.push("add"); state.attached = true; return providerDomain(); },
    verifyProviderDomain: async () => { state.calls.push("verify"); return providerDomain(); },
    removeProviderDomain: async () => { state.calls.push("remove"); if (state.removalFails) throw new Error("provider offline"); state.attached = false; },
    providerOwnershipRecords: (value: ReturnType<typeof providerDomain>) => value.verification.map(item => ({ type: "TXT", name: item.domain, value: item.value })),
  };
  const api = load<typeof import("../lib/data/portal-domains.ts")>("lib/data/portal-domains.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => db }, "../portal-domains": domains, "../portal-domain-provider": provider, "node:dns/promises": { Resolver },
    "node:tls": { connect: (options: { host: string; servername: string; rejectUnauthorized: boolean }) => {
      state.tlsCalls++; assert.equal(options.host, "216.150.1.1"); assert.equal(options.servername, "portal.example.com"); assert.equal(options.rejectUnauthorized, true);
      const socket = Object.assign(new EventEmitter(), { authorized: state.certificate, setTimeout() {}, destroy() {} }); queueMicrotask(() => socket.emit("secureConnect")); return socket;
    } },
  });
  return { state, api };
}

test("ownership must be proven before provisioning; DNS and HTTPS are separate activation gates", async () => {
  const { state, api } = fixture();
  const added = await api.connectPortalDomain("portal.example.com");
  assert.equal(added.status, "pending_dns"); assert.equal(added.records.length, 2); assert.equal(state.attached, false);
  state.calls = [];
  assert.equal((await api.verifyPortalDomain()).status, "pending_dns"); assert.deepEqual(state.calls, []);
  state.owns = true;
  assert.equal((await api.verifyPortalDomain()).status, "pending_ssl"); assert.equal(state.attached, true);
  state.certificate = true;
  assert.equal((await api.verifyPortalDomain()).status, "connected");
  state.dnsReady = false;
  assert.equal((await api.verifyPortalDomain()).status, "pending_dns");
  state.dnsReady = true; state.providerVerified = false;
  const pending = await api.verifyPortalDomain();
  assert.equal(pending.status, "pending_dns"); assert.ok(pending.records.some(item => item.name === "_vercel.example.com"));
});

test("private DNS cannot reach the TLS probe and connection failures never become success", async () => {
  const { state, api } = fixture();
  await api.connectPortalDomain("portal.example.com"); state.owns = true; state.certificate = true; state.addresses = ["127.0.0.1"];
  assert.equal((await api.verifyPortalDomain()).status, "pending_ssl"); assert.equal(state.tlsCalls, 0);
});

test("disconnect failures disable routing but retain a retryable reservation", async () => {
  const { state, api } = fixture();
  await api.connectPortalDomain("portal.example.com"); state.owns = true; state.certificate = true;
  await api.verifyPortalDomain(); state.removalFails = true;
  await assert.rejects(api.disconnectPortalDomain(), /provider offline/);
  assert.equal(state.row?.status, "disconnecting"); assert.equal(state.row?.operation_token, null);
  await assert.rejects(api.verifyPortalDomain(), /Finish disconnecting/);
  state.removalFails = false; await api.disconnectPortalDomain();
  assert.equal(state.row, null); assert.equal(state.attached, false);
});

test("verification and disconnect cannot race or release another operation's lease", async () => {
  const { state, api } = fixture(); await api.connectPortalDomain("portal.example.com"); state.owns = true;
  let unblock!: () => void; state.barrier = new Promise<void>(resolve => { unblock = resolve; });
  const checking = api.verifyPortalDomain(); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(api.disconnectPortalDomain(), /already in progress/);
  assert.ok(state.row?.operation_token); unblock(); await checking; assert.equal(state.row?.operation_token, null);
});

test("domains already assigned to the project cannot be claimed as portal domains", async () => {
  const { state, api } = fixture(); state.attached = true;
  await assert.rejects(api.connectPortalDomain("portal.example.com"), /already assigned/);
  assert.equal(state.row, null);
  await assert.rejects(api.connectPortalDomain("crm.filazoosupply.com"), /already used/);
});

test("host lookup independently rejects cross-workspace invoice capabilities and pending hosts", async () => {
  let workspace = "tenant-a", status = "connected";
  const chain = { select() { return chain; }, eq() { return chain; }, async maybeSingle() { return { data: { hostname: "portal.example.com", workspace_id: workspace, status }, error: null }; } };
  const api = load<typeof import("../lib/data/portal-domain-routing.ts")>("lib/data/portal-domain-routing.ts", { "../supabase/control": { createSupabaseControl: () => ({ from: () => chain }) }, "../supabase/admin": {}, "../portal-domains": domains });
  const request = new Request("https://portal.example.com/api/customer/session");
  await api.assertPortalWorkspaceHost(request, "tenant-a");
  workspace = "tenant-b"; await assert.rejects(api.assertPortalWorkspaceHost(request, "tenant-a"), /does not belong/);
  workspace = "tenant-a"; status = "pending_ssl"; await assert.rejects(api.assertPortalWorkspaceHost(request, "tenant-a"), /does not belong/);
  await api.assertPortalWorkspaceHost(new Request("https://crm.filazoosupply.com/api/customer/session"), "tenant-a");
});

test("custom hosts serve customer routes and the welcome page, while staff, legacy and unknown hosts are blocked", async () => {
  let status = "connected";
  const api = load<typeof import("../proxy.ts")>("proxy.ts", { "@/lib/portal-domains": domains, "@/lib/data/portal-domain-routing": { findPortalDomain: async (hostname: string) => hostname === "portal.example.com" ? { workspace_id: "tenant-a", status } : null }, "@/lib/supabase/proxy": { updateSession: async () => new Response("customer") } });
  assert.equal((await api.proxy(new NextRequest("https://portal.example.com/"))).headers.get("x-middleware-rewrite"), "https://portal.example.com/customer/domain");
  for (const path of ["/account", "/pages/about", "/pages/contact"]) {
    assert.equal((await api.proxy(new NextRequest(`https://portal.example.com${path}`))).headers.get("x-middleware-rewrite"), `https://portal.example.com/customer/domain${path}`);
  }
  assert.equal((await api.proxy(new NextRequest("https://portal.example.com/customer/invoices/id"))).status, 200);
  for (const path of ["/login", "/companies", "/api/invoices", "/customer/legacy/id"]) assert.equal((await api.proxy(new NextRequest(`https://portal.example.com${path}`))).status, 404);
  status = "pending_ssl"; assert.equal((await api.proxy(new NextRequest("https://portal.example.com/"))).status, 404);
  assert.equal((await api.proxy(new NextRequest("https://unrelated.example.com/"))).status, 404);
});

test("domain mutations require an admin before touching hosting or the database", async () => {
  let writes = 0;
  const api = load<typeof import("../app/customer-portal/domains/actions.ts")>("app/customer-portal/domains/actions.ts", {
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { assert.equal(roles.join(","), "admin"); throw new Error("Access denied"); } },
    "@/lib/workspace-context": { withWorkspaceViewer: () => { writes++; } }, "@/lib/portal-domains": domains, "@/lib/data/portal-domains": {}, "next/cache": {},
  });
  for (const action of ["connect", "verify", "disconnect"] as const) await assert.rejects(api.updatePortalDomain(action, "portal.example.com"), /Access denied/);
  assert.equal(writes, 0);
});

test("hosting adapter uses the configured project, team and server token with current Vercel endpoints", async () => {
  const calls: { url: URL; method: string; authorization: string; body?: string }[] = [];
  const api = load<typeof import("../lib/portal-domain-provider.ts")>("lib/portal-domain-provider.ts", {}, { PORTAL_VERCEL_TOKEN: "test-server-token", PORTAL_VERCEL_PROJECT_ID: "prj_test", PORTAL_VERCEL_TEAM_ID: "team_test" }, {
    fetch: async (url: URL, options: { method: string; headers: { Authorization: string }; body?: string }) => { calls.push({ url, method: options.method, authorization: options.headers.Authorization, body: options.body }); return Response.json({ name: "portal.example.com", verified: true }); },
  });
  await api.addProviderDomain("portal.example.com"); await api.verifyProviderDomain("portal.example.com"); await api.getProviderConfig("portal.example.com"); await api.removeProviderDomain("portal.example.com");
  assert.deepEqual(calls.map(call => [call.method, call.url.pathname]), [["POST", "/v10/projects/prj_test/domains"], ["POST", "/v9/projects/prj_test/domains/portal.example.com/verify"], ["GET", "/v6/domains/portal.example.com/config"], ["DELETE", "/v9/projects/prj_test/domains/portal.example.com"]]);
  assert.equal(calls[0].body, JSON.stringify({ name: "portal.example.com" }));
  assert.ok(calls.every(call => call.url.origin === "https://api.vercel.com" && call.url.searchParams.get("teamId") === "team_test" && call.authorization === "Bearer test-server-token"));
  const unavailable = load<typeof api>("lib/portal-domain-provider.ts", {}, {}, { fetch: () => { throw new Error("must not call hosting"); } });
  assert.equal(unavailable.portalDomainHostingReady(), false);
  await assert.rejects(unavailable.addProviderDomain("portal.example.com"), /not been enabled/);
});
