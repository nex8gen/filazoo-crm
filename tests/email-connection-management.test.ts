import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const id = "00000000-0000-4000-8000-000000000001";
function fixture(role = "admin", scope = "personal", owner = "me") {
  const updates: Record<string, unknown>[] = [];
  const filters: Record<string, unknown> = {};
  let clients = 0;
  const paths: string[] = [];
  const dependencies: Record<string, unknown> = {
    zod: { z }, "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "me", role }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => {
      clients++;
      let values: Record<string, unknown> = {};
      const query = {
        update: (record: Record<string, unknown>) => { values = record; return query; },
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        select: () => query,
        maybeSingle: async () => {
          const permitted = filters.id === id && filters.type === scope && (scope === "workspace" || filters.user_id === owner);
          if (permitted) updates.push(values);
          return { data: permitted ? { id } : null, error: null };
        },
      };
      return { from: () => query };
    } },
  };
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(readFileSync(new URL("../app/settings/apps/email-account-actions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; } });
  return { action: exports.setEmailConnectionActive as typeof import("../app/settings/apps/email-account-actions.ts").setEmailConnectionActive, updates, filters, paths, clients: () => clients };
}

function form(scope: string, operation = "pause") {
  const data = new FormData();
  data.set("id", id); data.set("scope", scope); data.set("operation", operation);
  return data;
}

test("team pause and resume require an administrator before any database request", async () => {
  for (const role of ["operator", "bd_manager", "viewer"]) {
    const instance = fixture(role, "workspace");
    assert.match((await instance.action(undefined, form("workspace")))?.error ?? "", /administrator/);
    assert.equal(instance.clients(), 0);
    assert.equal(instance.updates.length, 0);
  }
});

test("even administrators can only change their own personal connections", async () => {
  const instance = fixture("admin", "personal", "another-user");
  assert.ok((await instance.action(undefined, form("personal")))?.error);
  assert.equal(instance.filters.user_id, "me");
  assert.equal(instance.updates.length, 0);
});

test("forged scope cannot turn a personal mailbox into a team management target", async () => {
  const instance = fixture("admin", "personal");
  assert.ok((await instance.action(undefined, form("workspace")))?.error);
  assert.equal(instance.filters.type, "workspace");
  assert.equal(instance.updates.length, 0);
});

test("pause and resume only update active state and retain defaults, history, and credentials", async () => {
  for (const scope of ["personal", "workspace"]) {
    for (const operation of ["pause", "resume"]) {
      const instance = fixture("admin", scope);
      assert.ok((await instance.action(undefined, form(scope, operation)))?.success);
      assert.equal(instance.updates[0].is_active, operation === "resume");
      assert.deepEqual(Object.keys(instance.updates[0]).sort(), ["is_active", "updated_at"]);
      assert.equal(instance.filters.id, id);
      assert.equal(instance.filters.type, scope);
      assert.ok(instance.paths.includes("/email"));
    }
  }
});

test("the new email hub does not accept delete operations", async () => {
  const instance = fixture();
  assert.ok((await instance.action(undefined, form("personal", "delete")))?.error);
  assert.equal(instance.clients(), 0);
  assert.equal(instance.updates.length, 0);
});
