import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../lib/crm-model.ts";
import * as inventory from "../lib/product-inventory.ts";
import * as threading from "../lib/email-threading.ts";

const require = createRequire(import.meta.url);
function load(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name in deps ? deps[name] : name === "zod" ? require(name) : {}, Date, Intl, Map, Set, console, process: { env: { NODE_ENV: "test" } } });
  return exports;
}
function chain(result: unknown, record: (method: string, args: unknown[]) => void = () => {}) {
  const query: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  for (const method of ["select", "or", "order", "range", "eq", "limit", "maybeSingle"]) query[method] = (...args: unknown[]) => { record(method, args); return query; };
  return query;
}

test("company selectors and segments read all pages without loading history or staff avatars", async () => {
  let authorized = false;
  const fields: string[] = [];
  const ranges: number[] = [];
  const rows = Array.from({ length: 501 }, (_, index) => ({ id: String(index), name: "Company " + index, segment: "B2B", country: "US", source: "shopify", status: "new", company_profiles: [{ fit_score: 7 }], contacts: [{ email: "buyer@example.com" }], pipeline: [{ stage: "interested" }] }));
  const api = load("../lib/data/crm.ts", {
    "../auth.ts": { requireWorkspaceMember: async () => { authorized = true; } },
    "../env.ts": { env: { authRequired: true }, hasSupabaseConfig: () => true },
    "../crm-model.ts": model,
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from(table: string) {
      assert.ok(authorized); assert.equal(table, "companies");
      let offset = 0;
      const query = chain(null, (method, args) => { if (method === "select") fields.push(String(args[0])); if (method === "range") { offset = Number(args[0]); ranges.push(offset); } });
      query.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: rows.slice(offset, offset + 500), error: null }).then(resolve);
      return query;
    } }) },
    "./cached-member-avatars.ts": { resolveMemberAvatars: () => { throw new Error("Selectors must not fetch avatars"); } },
  });
  const options = await api.listCompanyOptions() as { companies: unknown[] };
  assert.equal(options.companies.length, 501);
  assert.ok(fields.every(field => field === "id,name"));
  fields.length = 0;
  const segments = await api.listSegmentCompanies() as { companies: Array<{ fitScore: number; hasEmail: boolean; sourceLabel: string; stage: string }> };
  assert.equal(segments.companies.length, 501);
  assert.equal(segments.companies[0].fitScore, 7);
  assert.equal(segments.companies[0].hasEmail, true);
  assert.equal(segments.companies[0].sourceLabel, "Shopify B2B");
  assert.equal("stage" in segments.companies[0], false);
  assert.ok(fields.every(field => !/emails|owner_id|meta_leads|summary/.test(field)));
  assert.deepEqual(ranges, [0, 500, 0, 500]);
});

test("inventory status and scoped snapshots start in parallel and retain every stock page", { timeout: 5000 }, async () => {
  let stockStarted = false;
  let releaseRun: () => void = () => {};
  const stockReady = new Promise<void>(resolve => { releaseRun = resolve; });
  const scopes: string[] = [];
  const pages: number[] = [];
  const now = new Date().toISOString();
  const api = load("../lib/data/inventory.ts", {
    "react": { cache: (fn: unknown) => fn }, "server-only": {},
    "../auth.ts": { requireWorkspaceMember: async () => ({ id: "staff" }) },
    "../env.ts": { hasSupabaseConfig: () => true },
    "./erp-settings.ts": { configuredErp: async () => ({ scope: "current-account-and-warehouse", skuMap: {}, warehouseIds: "wh-1" }) },
    "../product-inventory.ts": inventory,
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from(table: string) {
      let offset = 0;
      const query = chain(null, (method, args) => { if (method === "eq" && args[0] === "scope") scopes.push(String(args[1])); if (method === "range") { offset = Number(args[0]); pages.push(offset); } });
      query.then = async (resolve: (value: unknown) => void) => {
        if (table === "inventory_sync_runs") { await stockReady; return resolve({ data: [{ status: "succeeded", finished_at: now }], error: null }); }
        assert.equal(table, "erp_inventory"); stockStarted = true; releaseRun();
        resolve({ data: Array.from({ length: offset === 0 ? 1000 : 1 }, (_, index) => ({ sku: String(offset + index), available: 2, on_hand: 3, locked: 1, warehouse_ids: ["wh-1"], synced_at: now })), error: null });
      };
      return query;
    } }) },
  });
  const state = await api.getInventoryState() as { snapshots: unknown[]; status: { lastSyncedAt: string } };
  assert.ok(stockStarted);
  assert.equal(state.snapshots.length, 1001);
  assert.equal(state.status.lastSyncedAt, now);
  assert.deepEqual(pages, [0, 1000]);
  assert.ok(scopes.every(scope => scope === "current-account-and-warehouse"));
  await api.withErpInventory([], state);
  assert.deepEqual(pages, [0, 1000], "prepared inventory must not trigger a second read");
});

test("multi-account inbox reads share CRM and state snapshots within one authorized request", async () => {
  const counts = { states: 0, drafts: 0, replies: 0, assigned: 0, shopify: 0, sent: 0 };
  const viewer = { id: "staff", role: "admin" };
  const mailboxes = [{ id: "team-1", type: "workspace", email: "one@example.com" }, { id: "team-2", type: "workspace", email: "two@example.com" }, { id: "mine", type: "personal", email: "me@example.com" }];
  const api = load("../lib/email-inbox.ts", {
    "./auth.ts": { requireWorkspaceMember: () => { throw new Error("Authorized context must be reused"); } },
    "./data/mailboxes.ts": { mailboxHasImap: () => false, mailboxHasSmtp: () => false },
    "./mailbox-utils.ts": { defaultViewerMailbox: () => mailboxes[0] },
    "./data/crm.ts": { listEmailDrafts: async () => { counts.drafts++; return { emails: [], mode: "live" }; }, listReplies: async () => { counts.replies++; return { replies: [] }; } },
    "./data/email-state.ts": { listEmailInboxStates: async () => { counts.states++; return new Map(); }, listSentMailboxMessages: async () => { counts.sent++; return []; }, getEmailAutomationSettings: async () => ({ enabled: false, queueCount: 0, steps: [] }) },
    "./data/email-access.ts": { getAssignedEmailContacts: async () => { counts.assigned++; return null; } },
    "./data/inbox-companies.ts": { listInboxCompanies: async () => ({ companies: [] }) },
    "./email-access.ts": { canViewEmail: () => true }, "./email-threading.ts": threading,
    "./supabase/admin.ts": { createSupabaseAdmin: () => ({ from(table: string) { assert.equal(table, "shopify_leads"); counts.shopify++; return chain({ data: [], error: null }); } }) },
  });
  const context = api.createEmailInboxReadContext(viewer, mailboxes);
  const snapshots = await Promise.all(mailboxes.map(mailbox => api.getEmailInboxBackendData({ syncMailbox: false, mailboxId: mailbox.id, context })));
  assert.equal(snapshots.length, 3);
  assert.deepEqual(counts, { states: 1, drafts: 1, replies: 1, assigned: 1, shopify: 1, sent: 3 });
});

test("temporary authentication failures are not reported as incorrect credentials", async () => {
  for (const [status, expected] of [[0, "temporarily unavailable"], [429, "temporarily unavailable"], [503, "temporarily unavailable"], [400, "incorrect"]] as const) {
    const api = load("../app/login/actions.ts", {
      "@/lib/supabase/server": { createClient: async () => ({ auth: { signInWithPassword: async () => ({ data: {}, error: { status } }) } }) },
      "@/lib/supabase/admin": { createSupabaseAdmin: () => { throw new Error("No membership read after a failed sign-in"); } },
    });
    const form = new FormData(); form.set("email", "staff@example.com"); form.set("password", "example-password");
    const response = await api.login(undefined, form) as { error: string };
    assert.ok(response.error.includes(expected));
  }
});


test("workspace authorization validates the session once even where React.cache is inactive", async () => {
  for (const [signedIn, member, allowed, expected] of [[true, true, ["admin"], "ok"], [false, true, ["admin"], "/login"], [true, false, ["admin"], "/access-denied"], [true, true, ["viewer"], "/access-denied"]] as const) {
    let authReads = 0, memberReads = 0;
    const api = load("../lib/auth.ts", {
      "react": { cache: (fn: unknown) => fn },
      "./env.ts": { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co" }, hasSupabaseAuthConfig: () => true, hasSupabaseConfig: () => true },
      "./supabase/server.ts": { createClient: async () => ({ auth: { getClaims: async () => { authReads++; return { data: { claims: signedIn ? { sub: "aaaaaaaa-1111-2222-3333-444444444444", session_id: "bbbbbbbb-1111-2222-3333-444444444444", aud: "authenticated", role: "authenticated", iss: "https://test.supabase.co/auth/v1" } : null }, error: null }; } } }) },
      "./supabase/admin.ts": { createSupabaseAdmin: () => ({ rpc: () => { memberReads++; return chain({ data: { id: "aaaaaaaa-1111-2222-3333-444444444444", email: "staff@example.com", role: member ? "admin" : null, display_name: "Staff", activated_at: member ? "2026-01-01" : null }, error: null }); } }) },
      "./profile-avatar.ts": { isAvatarPreset: () => false }, "./user-preferences.ts": { readUserPreferences: () => ({}) },
      "next/server": { connection: async () => {} },
      "next/navigation": { redirect: (path: string) => { throw new Error(path); } },
    });
    if (expected === "ok") assert.equal((await api.requireWorkspaceMember(allowed) as { id: string }).id, "aaaaaaaa-1111-2222-3333-444444444444");
    else await assert.rejects(api.requireWorkspaceMember(allowed), error => error instanceof Error ? error.message === expected : String(error).includes(expected));
    assert.equal(authReads, 1);
    assert.equal(memberReads, signedIn ? 1 : 0);
  }
});


test("display-avatar caching is per project/member, expires before signed URLs and tolerates partial failures", async () => {
  const tags: string[] = [];
  const lifetimes: Array<{ stale: number; revalidate: number; expire: number }> = [];
  const reads: string[] = [];
  const api = load("../lib/data/cached-member-avatars.ts", {
    "server-only": {}, "next/cache.js": { cacheTag: (tag: string) => tags.push(tag), cacheLife: (life: { stale: number; revalidate: number; expire: number }) => lifetimes.push(life) },
    "../env.ts": { env: { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" } },
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({}) },
    "./member-avatars.ts": { resolveMemberAvatars: async (_admin: unknown, ids: string[]) => { reads.push(...ids); return ids[0] === "unavailable" ? new Map() : new Map([[ids[0], "/avatars/" + ids[0]]]); } },
  });
  const result = await api.resolveMemberAvatars(["one", "two", "one", "", "unavailable"]) as Map<string, string>;
  assert.equal(result.get("one"), "/avatars/one");
  assert.equal(result.get("two"), "/avatars/two");
  assert.equal(result.has("unavailable"), false);
  assert.deepEqual(reads, ["one", "two", "unavailable"]);
  assert.deepEqual(tags, ["member-avatar:one", "member-avatar:two", "member-avatar:unavailable"]);
  assert.ok(lifetimes.every(life => life.revalidate === 300 && life.expire === 3300 && life.expire < 3600));
});

test("catalog listing responds before PDF preparation and passes authorized product snapshots to background work", async () => {
  const callbacks: Array<() => Promise<void>> = [];
  const catalog = { id: "catalog", pdfUrl: null, productSkus: ["PLA"] };
  const products = [{ sku: "PLA" }];
  let preparations = 0;
  const api = load("../app/catalogs/companies/page.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/server": { after: (callback: () => Promise<void>) => callbacks.push(callback) },
    "@/lib/auth": { requireWorkspaceMember: async () => ({ role: "admin" }) },
    "@/lib/data/crm": { listCatalogs: async () => ({ mode: "live", catalogs: [catalog] }), listCompanyOptions: async () => ({ companies: [{ id: "company", name: "Acme" }] }), listProducts: async () => ({ products }) },
    "@/lib/data/catalog-pdfs": { prepareCompanyCatalogPdfs: async (catalogs: typeof catalog[], prepared: typeof products) => { preparations++; assert.equal(prepared, products); assert.notEqual(catalogs[0], catalog); catalogs[0].pdfUrl = "prepared" as never; } },
  });
  await api.default();
  assert.equal(preparations, 0);
  assert.equal(callbacks.length, 1);
  await callbacks[0]();
  assert.equal(preparations, 1);
  assert.equal(catalog.pdfUrl, null, "background work must not mutate already-rendered props");
});
