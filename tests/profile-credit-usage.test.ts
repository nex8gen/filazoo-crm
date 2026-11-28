import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as activity from "../lib/profile-credit-activity.ts";

type Row = { id: number; workspace_id: string; user_id: string; created_at: string; charged_micros: number | null; reserved_micros: number };
const viewer = { id: "member-a", workspaceId: "workspace-a", role: "viewer" };
const now = new Date("2026-11-30T16:00:00.000Z"); // December 1 in China.
const row = (id: number, overrides: Partial<Row> = {}): Row => ({ id, workspace_id: viewer.workspaceId, user_id: viewer.id, created_at: now.toISOString(), charged_micros: 125, reserved_micros: 500, ...overrides });

function reader(rows: Row[], options: { authenticated?: boolean; failPage?: number } = {}) {
  const pages: number[] = [];
  let scoped = false;
  const deps: Record<string, unknown> = {
    "server-only": {},
    "../profile-credit-activity.ts": activity,
    "../auth.ts": { requireWorkspaceMember: async () => { if (options.authenticated === false) throw new Error("Sign in required"); return viewer; } },
    "../workspace-context.ts": { withWorkspaceViewer: async (actor: unknown, work: () => Promise<unknown>) => { assert.equal(actor, viewer); scoped = true; try { return await work(); } finally { scoped = false; } } },
    "../supabase/admin.ts": { createSupabaseAdmin: () => {
      assert.ok(scoped, "database reads must have request-local workspace context");
      return { from: (table: string) => {
        assert.equal(table, "ai_budget_reservations");
        let filtered = [...rows];
        const query = {
          select: (fields: string) => { assert.equal(fields, "created_at,charged_micros,reserved_micros"); return query; },
          eq: (key: keyof Row, value: string) => { filtered = filtered.filter(item => item[key] === value); return query; },
          gte: (_key: string, value: string) => { filtered = filtered.filter(item => item.created_at >= value); return query; },
          lte: (_key: string, value: string) => { filtered = filtered.filter(item => item.created_at <= value); return query; },
          order: (key: string) => { assert.equal(key, "id"); filtered.sort((a, b) => a.id - b.id); return query; },
          range: async (from: number, to: number) => { pages.push(from); return { data: filtered.slice(from, to + 1), error: options.failPage === from ? { message: "Database unavailable" } : null }; },
        };
        return query;
      } };
    } },
  };
  const exports: { readPersonalCreditUsage?: (now: Date) => Promise<{ usedMicros: number; pendingMicros: number; activity: activity.CreditActivityDay[]; startDate: string; endDate: string }> } = {};
  const source = ts.transpileModule(readFileSync(new URL("../lib/data/profile-credit-usage.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Date, require: (name: string) => { assert.ok(name in deps, `Unexpected dependency: ${name}`); return deps[name]; } });
  return { read: () => exports.readPersonalCreditUsage!(now), pages };
}

test("personal credits exclude other members, other workspaces and dates outside the China calendar month", async () => {
  const { read } = reader([
    row(1), row(2, { charged_micros: 0 }), row(3, { charged_micros: null }),
    row(4, { user_id: "member-b" }), row(5, { workspace_id: "workspace-b" }),
    row(6, { created_at: "2026-11-30T15:59:59.999Z" }), row(7, { created_at: "2026-11-30T16:00:00.001Z" }),
  ]);
  const result = await read();
  assert.equal(result.usedMicros, 125);
  assert.equal(result.pendingMicros, 500, "unfinished reservations stay separate from settled usage");
  assert.equal(result.activity.length, 2);
  assert.equal(result.activity[0].date, "2026-11-30");
  assert.equal(result.activity[0].usedMicros, 125, "previous-month usage belongs in activity but not the current-month total");
  assert.equal(result.activity[1].usedMicros, 125, "activity excludes unfinished, foreign-member and foreign-workspace requests");
});

test("personal usage includes all pages beyond the default database row limit", async () => {
  const { read, pages } = reader(Array.from({ length: 1001 }, (_, index) => row(index)));
  assert.equal((await read()).usedMicros, 125125);
  assert.deepEqual(pages, [0, 500, 1000]);
});

test("an empty month is zero usage; a failed later page never returns an understated total", async () => {
  assert.equal((await reader([]).read()).usedMicros, 0);
  const failing = reader(Array.from({ length: 501 }, (_, index) => row(index)), { failPage: 500 });
  await assert.rejects(failing.read(), /Unable to load personal credit usage/);
});

test("unauthenticated calls fail before opening a database client", async () => {
  const { read, pages } = reader([row(1)], { authenticated: false });
  await assert.rejects(read(), /Sign in required/);
  assert.deepEqual(pages, []);
});

test("the annual heatmap aggregates each China day without exposing underlying requests", async () => {
  const { read } = reader([
    row(1, { created_at: "2026-01-01T00:00:00.000Z" }),
    row(2, { created_at: "2026-01-01T15:59:59.999Z" }),
    row(3, { created_at: "2026-01-01T16:00:00.000Z" }),
    row(4, { created_at: "2025-12-31T15:59:59.999Z" }),
  ]);
  const result = await read();
  assert.equal(result.usedMicros, 0);
  assert.equal(result.startDate, "2026-01-01");
  assert.equal(result.endDate, "2026-12-01");
  assert.equal(JSON.stringify(result.activity), JSON.stringify([{ date: "2026-01-01", usedMicros: 250 }, { date: "2026-01-02", usedMicros: 125 }]));
});
