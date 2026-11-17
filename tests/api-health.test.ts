import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup(mode: "ready" | "error" | "timeout" | "missing") {
  const calls: unknown[] = [];
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: Response },
    "@/lib/env": { env: { dryRun: true, flowDryRun: false }, hasSupabaseConfig: () => mode !== "missing" },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ from: (table: string) => {
      calls.push(table);
      return { select: () => ({ limit: () => ({ abortSignal: async (signal: AbortSignal) => {
        assert.ok(signal instanceof AbortSignal);
        if (mode === "timeout") throw new Error("secret connection details");
        return { error: mode === "error" ? { message: "secret database details" } : null };
      } }) }) };
    } }) },
  };
  const exports = {} as { GET: () => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, Date, AbortSignal: { timeout: (ms: number) => { calls.push(ms); return new AbortController().signal; } } });
  return { ...exports, calls };
}

test("platform health is bounded, uncached, and independent of a visitor's tenant", async () => {
  const app = setup("ready");
  const response = await app.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(app.calls, ["workspaces", 5000]);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.database, "connected");
  assert.equal(body.flowDryRun, false);
});

test("missing configuration, database failures, and timeouts return degraded health without secrets", async () => {
  for (const mode of ["error", "timeout", "missing"] as const) {
    const response = await setup(mode).GET();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.status, "degraded");
    assert.doesNotMatch(JSON.stringify(body), /secret/);
  }
});
