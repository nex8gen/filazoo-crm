import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../lib/crm-model.ts";

type Row = Record<string, unknown>;
const row = { id: "4913b683-bcec-4079-b424-6fd559ed0c2a", name: "Acme", domain: "acme.test", website: "https://acme.test", source: "manual", status: "new", contacts: [], meta_leads: [], company_profiles: [], pipeline: [] };
function load(options: { demo?: boolean; denied?: boolean; failure?: boolean; rows?: Row[]; ownerGate?: boolean } = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  let authorized = false;
  let avatarStarted = false;
  let releaseOwners: () => void = () => {};
  const ownerReady = new Promise<void>(resolve => { releaseOwners = resolve; });
  const client = { from(table: string) {
    assert.ok(authorized, "authorization must precede database access");
    const filters = new Map<string, unknown>();
    let start = 0, end = 499;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "or", "order", "range", "eq", "in"]) query[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      if (method === "eq") filters.set(String(args[0]), args[1]);
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
      const data = rows.filter(item => !filters.has("id") || item.id === filters.get("id")).slice(start, end + 1);
      return resolve({ data, error: null });
    };
    return query;
  } };
  const deps: Record<string, unknown> = {
    "../auth.ts": { requireWorkspaceMember: async () => { if (options.denied) throw new Error("Unauthorized"); authorized = true; } },
    "../env.ts": { env: { authRequired: true }, hasSupabaseConfig: () => !options.demo },
    "../supabase/admin.ts": { createSupabaseAdmin: () => client },
    "../crm-model.ts": model,
    "../order-estimate.ts": { metaOrderLabel: () => "" },
    "./member-avatars.ts": { resolveMemberAvatars: async () => { avatarStarted = true; releaseOwners(); return new Map([["owner-1", "/avatar.png"]]); } },
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
  assert.ok(calls.some(call => call.table === "companies" && call.method === "eq" && call.args[0] === "id" && call.args[1] === row.id));
  assert.ok(calls.some(call => call.method === "or" && call.args[0] === "source.is.null,source.neq.sample_seed"));
  assert.equal(calls.filter(call => call.table === "companies" && call.method === "range").length, 1);
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
