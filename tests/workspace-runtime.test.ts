import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup(error?: { code: string }, count = 6) {
  const rows = Array.from({ length: count }, (_, id) => ({ id: `workspace-${id}` }));
  const pages: number[] = [];
  const query = { order: () => query, range: (from: number, to: number) => ({ abortSignal: async (signal: AbortSignal) => {
    assert.ok(signal instanceof AbortSignal);
    pages.push(from);
    return { data: error ? null : rows.slice(from, to + 1), error };
  } }) };
  const dependencies: Record<string, unknown> = {
    react: { cache: (fn: unknown) => fn },
    "../auth.ts": { getWorkspaceViewer: async () => null },
    "../supabase/control.ts": { createSupabaseControl: () => ({ from: () => ({ select: () => query }) }) },
    "../workspace-context.ts": { currentWorkspaceContext: () => null, withWorkspaceContext: (_id: string, run: () => unknown) => run() },
  };
  const exports = {} as { forEachWorkspace: <T>(work: (id: string, count: number) => Promise<T>, options?: { throwOnError?: boolean }) => Promise<T[]> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/workspace-runtime.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, Date, Error, AggregateError, AbortSignal, console: { error() {} } });
  return { ...exports, pages };
}

test("background work continues to other workspaces after a tenant fails", async () => {
  const calls: string[] = [];
  const results = await setup().forEachWorkspace(async (id, count) => {
    calls.push(id);
    assert.equal(count, 6);
    if (id === "workspace-0") throw new Error("unavailable");
    return id;
  });
  assert.equal(calls.length, 6);
  assert.equal(results.length, 5);
});

test("strict readiness checks every tenant and rejects incomplete results", async () => {
  const calls: string[] = [];
  await assert.rejects(setup().forEachWorkspace(async id => {
    calls.push(id);
    if (["workspace-0", "workspace-4"].includes(id)) throw new Error("unavailable");
    return id;
  }, { throwOnError: true }), error => error instanceof AggregateError && error.errors.length === 2);
  assert.equal(calls.length, 6);
});

test("workspace catalog failures cannot masquerade as an empty healthy platform", async () => {
  await assert.rejects(setup({ code: "connection-error" }).forEachWorkspace(async () => true), /Unable to load scheduled workspaces/);
  assert.deepEqual(Array.from(await setup({ code: "42P01" }).forEachWorkspace(async id => id)), ["legacy"]);
});

test("workspaces beyond the database response limit still receive background work", async () => {
  const app = setup(undefined, 1005);
  const results = await app.forEachWorkspace(async (id, count) => {
    assert.equal(count, 1005);
    return id;
  });
  assert.equal(results.length, 1005);
  assert.equal(new Set(results).size, 1005);
  assert.equal(results.at(-1), "workspace-1004");
  assert.deepEqual(app.pages, [0, 250, 500, 750, 1000]);
});
