import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as list from "../lib/company-list.ts";
import { companyListAnalytics } from "../lib/company-list-analytics.ts";
import * as avatars from "../lib/member-avatar-url.ts";

const require = createRequire(import.meta.url);
function load(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => deps[id] ?? (id === "../member-avatar-url.ts" ? avatars : require(id)), Map, URL, URLSearchParams, Response, Date });
  return exports;
}

test("invalid page inputs are bounded and register URLs preserve the selected segment", () => {
  for (const page of [0, -1, 1.5, "wrong", 1e12]) {
    assert.equal(list.companyListRequestSchema.parse({ page }).page, 1);
  }
  assert.equal(list.companyListRequestSchema.parse({ page: "3", pageSize: 100 }).page, 3);
  assert.equal(list.companyListRequestSchema.parse({ pageSize: 5000 }).pageSize, 25);
  const href = list.companyListHref("segmentId=audience&q=old&country=Brazil&page=5", { page: 1, q: "new", country: "all" });
  assert.equal(href, "/companies?segmentId=audience&q=new&page=1");
});

test("daily database summaries preserve all six cohort metrics for every selectable period", () => {
  const asOf = "2026-11-27T00:00:00Z", dayMs = 86400000;
  const rows = Array.from({ length: 180 }, (_, i) => ({ addedAt: new Date(Date.parse(asOf) - (179 - i) * dayMs).toISOString(),
    customerTags: i % 3 === 0 ? ["New Inquiries", "Customer replied"] as const : [], outreachStatus: i % 4 === 0 ? "Email sent" : "Not started", paidOrderCount: i % 7 === 0 ? 2 : 0 }));
  // Include the exact lower boundary and one older record.
  rows.push({ ...rows[0], addedAt: new Date(Date.parse(asOf) - 180 * dayMs).toISOString() });
  const buckets: list.CompanyAnalyticsBucket[] = [];
  for (const row of rows) {
    const day = Math.min(179, Math.floor((Date.parse(row.addedAt) - (Date.parse(asOf) - 180 * dayMs)) / dayMs));
    const bucket = buckets.find(bucket => bucket.day === day) ?? (() => { const value = { day, counts: [0, 0, 0, 0, 0] }; buckets.push(value); return value; })();
    // Classification is independent of the cohort window.
    bucket.counts = bucket.counts.map((v, i) => v + (i === 0 ? 1 : i === 1 ? Number(row.outreachStatus.startsWith("Email") || row.customerTags.includes("Customer replied")) : i === 2 ? Number(row.customerTags.includes("Customer replied")) : i === 3 ? Number(row.customerTags.includes("New Inquiries")) : Number(row.paidOrderCount > 0)));
  }
  for (const days of [7, 30, 90]) assert.deepEqual(list.companyListBucketAnalytics(buckets, days), companyListAnalytics(rows, days, asOf));
});

function fixture(role = "admin", failure = false, denied = false) {
  const reads: unknown[] = [], calls: unknown[] = [];
  const ids = ["second", "first"];
  const api = load("../lib/data/company-list.ts", {
    "../auth.ts": { requireWorkspaceMember: async () => { if (denied) throw new Error("Unauthorized"); return { id: "manager", role }; } },
    "../company-list.ts": list,
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: { ids, page: 2, total: 52, countries: ["Brazil"], segments: [], buckets: [] }, error: failure ? { message: "offline" } : null }; } }) },
    "./crm.ts": { getCrmDataMode: () => "live", listCompanies: async (args: unknown) => { reads.push(args); return { companies: [{ id: "first" }, { id: "second" }] }; } },
  });
  return { api, reads, calls };
}

test("a page hydrates only returned IDs, preserves database order and restricts BD reads", async () => {
  const f = fixture("bd_manager");
  const result = await f.api.listCompanyPage(list.companyListRequestSchema.parse({ page: 2, query: "buyer", country: "Brazil" }), { hasEmail: true }, "2026-11-27T00:00:00Z") as list.CompanyListPage;
  assert.deepEqual(JSON.parse(JSON.stringify(f.reads)), [{ ids: ["second", "first"] }]);
  assert.deepEqual(result.companies.map(company => company.id), ["second", "first"]);
  const [name, args] = f.calls[0] as [string, Record<string, unknown>];
  assert.equal(name, "crm_company_list_page");
  assert.equal(args.p_owner, "manager"); assert.equal(args.p_page, 2); assert.equal(args.p_size, 25);
  assert.equal(args.p_query, "buyer"); assert.equal(args.p_country, "Brazil");
  assert.equal(result.total, 52);
});

test("authorization and database errors never trigger an unbounded company fallback", async () => {
  for (const [failure, denied] of [[true, false], [false, true]]) {
    const f = fixture("viewer", failure, denied);
    await assert.rejects(f.api.listCompanyPage(list.companyListRequestSchema.parse({})), failure ? /offline/ : /Unauthorized/);
    assert.equal(f.reads.length, 0);
    if (denied) assert.equal(f.calls.length, 0);
  }
});

test("a current database returns visible company rows without hydration or avatar requests", async () => {
  const mapped: unknown[] = [];
  const api = load("../lib/data/company-list.ts", {
    "../auth.ts": { requireWorkspaceMember: async () => ({ id: "manager", role: "admin" }) },
    "../company-list.ts": list,
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ rpc: async () => ({ data: { ids: ["visible"], rows: [{ row: { id: "visible", pipeline: { owner_id: "manager" } }, ownerName: "Owner", paidOrderCount: 3 }], page: 1, total: 100, countries: [], segments: [], buckets: [] }, error: null }) }) },
    "./crm.ts": { getCrmDataMode: () => "live", listCompanies: async () => { assert.fail("Extra company read"); },
      mapCompany: (row: { id: string }, names: Map<string,string>, photos: Map<string,string>, paid: number) => { mapped.push([names.get("manager"),photos.get("manager"),paid]); return { id: row.id }; } },
  });
  const result = await api.listCompanyPage(list.companyListRequestSchema.parse({})) as list.CompanyListPage;
  assert.deepEqual(JSON.parse(JSON.stringify(mapped)), [["Owner", "/api/members/avatar?memberId=manager", 3]]);
  assert.equal(result.companies.length, 1);
  assert.equal("rows" in result, false);
});

test("deferred owner photos authorize the workspace member before resolving private storage URLs", async () => {
  const id = "a0000000-0000-4000-8000-000000000001";
  for (const authorized of [false, true]) {
    let resolutions = 0, reads = 0;
    const query = { select: () => query, eq: () => query, not: () => query,
      maybeSingle: async () => { reads++; return { data: authorized ? { user_id: id } : null, error: null }; } };
    const route = load("../app/api/members/avatar/route.ts", {
      "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "actor", workspaceId: "workspace" }) },
      "@/lib/workspace-context": { withWorkspaceViewer: (_viewer: unknown, work: () => unknown) => work() },
      "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => query }) },
      "@/lib/data/cached-member-avatars": { resolveMemberAvatars: async () => { resolutions++; return new Map([[id, "https://storage.example.test/signed-photo"]]); } },
    });
    const response = await route.GET(new Request(`http://localhost/api/members/avatar?memberId=${id}`)) as Response;
    assert.equal(reads, 1);
    assert.equal(resolutions, Number(authorized));
    assert.equal(response.status, authorized ? 307 : 404);
    if (authorized) assert.equal(response.headers.get("Cache-Control"), "private, max-age=300");
    assert.equal((await route.GET(new Request("http://localhost/api/members/avatar?memberId=invalid")) as Response).status, 400);
    assert.equal(reads, 1);
  }
});

test("the Companies server page passes only a page to the table and defers export", async () => {
  const rendered: Array<{ name: string; props: Record<string, unknown> }> = [], reads: unknown[] = [];
  const leaf = (name: string) => (props: Record<string, unknown>) => { rendered.push({ name, props }); return props.children; };
  const api = load("../app/companies/page.tsx", {
    react: require("react"), "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": { default: leaf("Link") }, "next/navigation": { notFound: () => { throw new Error("not found"); } },
    "@/components/companies-table": { CompaniesTable: leaf("table") },
    "@/components/crm-action-dialogs": { ExportCompaniesButton: leaf("export"), AddCompanyButton: leaf("add") },
    "@/components/page-header": { PageActions: leaf("actions") },
    "@/lib/auth": { requireWorkspaceMember: async () => ({ role: "viewer", preferences: { tablePageSize: 10 } }) },
    "@/lib/data/company-list": { listCompanyPage: async (request: unknown) => { reads.push(request); return { mode: "live", companies: [], page: 3, total: 80, segments: ["Retail"] }; } },
    "@/lib/company-list": list,
    "@/lib/data/segments": { getSavedSegment: async () => null },
  });
  async function visit(node: unknown): Promise<void> {
    if (Array.isArray(node)) { for (const child of node) await visit(child); return; }
    if (!node || typeof node !== "object") return;
    const e = node as { type: unknown; props: { children?: unknown } };
    await visit(typeof e.type === "function" ? await e.type(e.props) : e.props?.children);
  }
  await visit(await api.default({ searchParams: Promise.resolve({ page: "3", q: "buyer" }) }));
  assert.equal((reads[0] as list.CompanyListRequest).pageSize, 10);
  assert.equal((reads[0] as list.CompanyListRequest).page, 3);
  assert.ok(rendered.find(row => row.name === "export")?.props.exportHref);
  assert.equal(rendered.find(row => row.name === "export")?.props.companies, undefined);
  assert.equal(rendered.find(row => row.name === "table")?.props.canDelete, false);
});

test("on-demand exports retain the whole selected segment and enforce authorization before data reads", async () => {
  const rows = Array.from({ length: 61 }, (_, i) => ({ id: String(i), segment: i < 40 ? "Retail" : "Wholesale" }));
  for (const denied of [false, true]) {
    let reads = 0;
    const route = load("../app/api/companies/export/route.ts", {
      "@/lib/auth": { requireWorkspaceMember: async () => { if (denied) throw new Error("Unauthorized"); } },
      "@/lib/data/crm": { listCompanies: async () => { reads++; return { companies: rows }; } },
      "@/lib/data/segments": { getSavedSegment: async () => null },
      "@/lib/segments": {},
      "@/lib/company-export": { companyExportCsv: (companies: unknown[]) => String(companies.length) },
    });
    const get = (query = "") => route.GET(new Request(`http://localhost/api/companies/export${query}`)) as Promise<Response>;
    if (denied) { await assert.rejects(get(), /Unauthorized/); assert.equal(reads, 0); }
    else {
      assert.equal(await (await get()).text(), "61");
      const retail = await get("?segment=Retail");
      assert.equal(await retail.text(), "40");
      assert.equal(retail.headers.get("Cache-Control"), "private, no-store");
      assert.equal((await get("?segmentId=invalid")).status, 400);
      assert.equal(reads, 2);
    }
  }
});
