import assert from "node:assert/strict";
import * as customerTags from "../lib/customer-tags.ts";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../lib/crm-model.ts";

type Row = Record<string, unknown>;
const row = { id: "4913b683-bcec-4079-b424-6fd559ed0c2a", name: "Acme", domain: "acme.test", website: "https://acme.test", source: "manual", status: "new", contacts: [], meta_leads: [], company_profiles: [], pipeline: [] };
function load(options: { demo?: boolean; denied?: boolean; failure?: boolean; rows?: Row[]; ownerGate?: boolean; role?: string } = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  let authorized = false;
  let avatarStarted = false;
  let releaseOwners: () => void = () => {};
  const ownerReady = new Promise<void>(resolve => { releaseOwners = resolve; });
  const client = { from(table: string) {
    assert.ok(authorized, "authorization must precede database access");
    const filters = new Map<string, unknown>();
    let start = 0, end = 499;
    let innerPipeline = false;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "or", "order", "range", "eq", "in", "limit"]) query[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      if (method === "eq") filters.set(String(args[0]), args[1]);
      if (method === "select") innerPipeline = String(args[0]).includes("pipeline!inner(");
      if (method === "in") filters.set(`in:${args[0]}`, args[1]);
      if (method === "range") [start, end] = args as [number, number];
      return query;
    };
    query.then = async (resolve: (value: unknown) => void) => {
      if (table === "workspace_members") {
        if (options.ownerGate) await ownerReady;
        return resolve({ data: [{ user_id: "owner-1", display_name: "Alice" }], error: null });
      }
      if (options.failure) return resolve({ data: null, error: { message: "database offline" } });
      const rows = options.rows ?? [row];
      const data = rows.filter(item => {
        if (filters.has("id") && item.id !== filters.get("id")) return false;
        if (filters.has("in:id") && !(filters.get("in:id") as unknown[]).includes(item.id)) return false;
        if (innerPipeline) {
          const pipeline = item.pipeline as Array<{ owner_id: string | null }>;
          if (!pipeline?.some(p => !filters.has("pipeline.owner_id") || p.owner_id === filters.get("pipeline.owner_id"))) return false;
        }
        return true;
      }).slice(start, end + 1);
      return resolve({ data, error: null });
    };
    return query;
  } };
  const deps: Record<string, unknown> = {
    "../customer-tags.ts": customerTags,
    "../auth.ts": { requireWorkspaceMember: async () => { if (options.denied) throw new Error("Unauthorized"); authorized = true; return { id: "owner-1", role: options.role ?? "admin" }; } },
    "../env.ts": { env: { authRequired: true }, hasSupabaseConfig: () => !options.demo },
    "../supabase/admin.ts": { createSupabaseAdmin: () => client },
    "../crm-model.ts": model,
    "./company-orders.ts": { readCompanyPaidOrderCounts: async () => { assert.ok(authorized); return new Map([[row.id, 4]]); } },
    "../order-estimate.ts": { metaOrderLabel: () => "" },
    "./cached-member-avatars.ts": { resolveMemberAvatars: async () => { avatarStarted = true; releaseOwners(); return new Map([["owner-1", "/avatar.png"]]); } },
  };
  const exports: Record<string, (...args: unknown[]) => Promise<{ company: Row | null; companies: Row[]; mode: string }>> = {};
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/crm.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? {}, process: { env: { NODE_ENV: "test" } }, Date, Intl, console });
  return { api: exports, calls, avatarStarted: () => avatarStarted };
}

test("single-company reads filter in the database and retain the existing company mapping", async () => {
  const { api, calls } = load({ rows: [{ ...row, id: "other" }, row] });
  const result = await api.getCompany(row.id);
  assert.equal(result.company?.id, row.id);
  assert.equal(result.company?.name, "Acme");
  assert.equal(result.company?.domain, "acme.test");
  assert.equal(result.company?.paidOrderCount, 4);
  assert.ok(calls.some(call => call.table === "companies" && call.method === "eq" && call.args[0] === "id" && call.args[1] === row.id));
  assert.ok(calls.some(call => call.method === "or" && call.args[0] === "source.is.null,source.neq.sample_seed"));
  assert.equal(calls.filter(call => call.table === "companies" && call.method === "range").length, 1);
});

test("company and segment reads retain mixed source history without changing the original lead segment", async () => {
  for (const [source, segment, label] of [
    ["meta_lead_ads+shopify_b2b_form", "Meta B2B lead", "Meta + Shopify B2B"],
    ["shopify_b2b_form+meta_lead_ads", "Shopify B2B lead", "Shopify B2B + Meta"],
  ]) {
    const { api } = load({ rows: [{ ...row, source, segment }] });
    for (const result of [await api.listCompanies(), await api.listSegmentCompanies()]) {
      assert.equal(result.companies[0].source, source);
      assert.equal(result.companies[0].sourceLabel, label);
      assert.equal(result.companies[0].segment, segment);
    }
    const { company } = await api.getCompany(row.id);
    assert.equal(company?.sourceLabel, label);
    assert.equal(company?.segment, segment);
  }
});

test("company listings bound embedded email history without limiting companies or dropping outreach status", async () => {
  const latest = { status: "sent", direction: "outbound", created_at: "2026-10-31T01:00:00Z" };
  const older = { status: "draft", direction: "outbound", created_at: "2026-10-01T01:00:00Z" };
  const { api, calls } = load({ rows: [{ ...row, contacts: [{ name: "Buyer", email: "buyer@example.com", emails: [older, latest] }] }] });
  const result = await api.listCompanies();
  assert.equal(result.companies[0].outreachStatus, "Email · sent");
  const limits = calls.filter(call => call.table === "companies" && call.method === "limit");
  assert.equal(limits.length, 1);
  assert.equal(limits[0].args[0], 1);
  assert.equal((limits[0].args[1] as { referencedTable: string }).referencedTable, "contacts.emails");
  assert.ok(calls.some(call => call.method === "order" && call.args[0] === "created_at" && (call.args[1] as { referencedTable?: string })?.referencedTable === "contacts.emails"));
  assert.ok(calls.filter(call => call.method === "select" && call.table === "companies").every(call => !String(call.args[0]).includes("meta_leads")));
});

test("missing companies return null and demo reads never touch the database", async () => {
  assert.equal((await load().api.getCompany("b02b78ed-3f6e-459a-a461-802f6d231af8")).company, null);
  const invalid = load();
  assert.equal((await invalid.api.getCompany("invalid-id")).company, null);
  assert.equal((await invalid.api.getCompany("")).company, null);
  assert.equal(invalid.calls.length, 0);
  const demo = load({ demo: true });
  assert.equal((await demo.api.getCompany(row.id)).company, null);
  assert.equal(demo.calls.length, 0);
});

test("company reads preserve authentication and surface database errors", async () => {
  const denied = load({ denied: true });
  await assert.rejects(denied.api.getCompany(row.id), /Unauthorized/);
  assert.equal(denied.calls.length, 0);
  await assert.rejects(load({ failure: true }).api.getCompany(row.id), /Unable to load companies: database offline/);
});

test("full-company lists still load all pages without applying a record filter", async () => {
  const { api, calls } = load({ rows: Array.from({ length: 501 }, (_, index) => ({ ...row, id: String(index) })) });
  const result = await api.listCompanies();
  assert.equal(result.companies.length, 501);
  assert.ok(calls.some(call => call.method === "range" && call.args[0] === 500 && call.args[1] === 999));
  assert.ok(!calls.some(call => call.table === "companies" && call.method === "eq"));
});

test("owner names and avatars start independently and both reach the company record", { timeout: 5000 }, async () => {
  const loaded = load({ rows: [{ ...row, pipeline: [{ owner_id: "owner-1", stage: "new" }] }], ownerGate: true });
  const { company } = await loaded.api.getCompany(row.id);
  assert.ok(loaded.avatarStarted());
  assert.equal(company?.ownerName, "Alice");
  assert.equal(company?.ownerAvatarUrl, "/avatar.png");
});

const ownershipRows = [
  { ...row, pipeline: [{ owner_id: "owner-1" }] },
  { ...row, id: "b02b78ed-3f6e-459a-a461-802f6d231af8", pipeline: [{ owner_id: "owner-2" }] },
  { ...row, id: "unassigned", pipeline: [{ owner_id: null }] },
  { ...row, id: "no-pipeline", pipeline: [] },
];

test("BD company lists, selectors, segments and selected exports include only current assignments", async () => {
  for (const method of ["listCompanies", "listCompanyOptions", "listSegmentCompanies"]) {
    const { api, calls } = load({ role: "bd_manager", rows: ownershipRows });
    const result = await api[method]();
    assert.deepEqual(Array.from(result.companies, company => company.id), [row.id]);
    assert.ok(calls.some(call => call.table === "companies" && call.method === "select" && String(call.args[0]).includes("pipeline!inner(")));
    assert.ok(calls.some(call => call.table === "companies" && call.method === "eq" && call.args[0] === "pipeline.owner_id" && call.args[1] === "owner-1"));
  }
  const { api } = load({ role: "bd_manager", rows: ownershipRows });
  assert.equal((await api.listCompanies({ ids: [ownershipRows[1].id] })).companies.length, 0);
  assert.equal((await api.getCompany(ownershipRows[1].id)).company, null);
  assert.equal((await api.getCompany(row.id)).company?.id, row.id);
});

test("other workspace roles retain company visibility, including unassigned companies", async () => {
  for (const role of ["admin", "operator", "viewer"]) {
    const { api, calls } = load({ role, rows: ownershipRows });
    for (const method of ["listCompanies", "listCompanyOptions", "listSegmentCompanies"]) {
      assert.equal((await api[method]()).companies.length, ownershipRows.length);
    }
    assert.ok(!calls.some(call => call.method === "eq" && call.args[0] === "pipeline.owner_id"));
  }
});

test("assignment filters apply before pagination and export limits", async () => {
  const ownRows = Array.from({ length: 501 }, (_, index) => ({ ...ownershipRows[0], id: String(index) }));
  const { api } = load({ role: "bd_manager", rows: [...Array(600).fill(ownershipRows[1]), ...ownRows] });
  assert.equal((await api.listCompanies({ maxCompanies: 501 })).companies.length, 501);
  await assert.rejects(api.listCompanies({ maxCompanies: 500 }), /exceeds 5,000/);
  assert.equal((await load({ role: "bd_manager", rows: ownershipRows.slice(1) }).api.listCompanies()).companies.length, 0);
});
