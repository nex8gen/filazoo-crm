import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { supabaseSessionDependencies } from "./helpers/supabase-session.ts";
import { isWorkspaceSessionRetry } from "../lib/workspace-session-response.ts";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
function gate(error: unknown) {
  const exports: { updateSession?: (request: unknown) => Promise<Response> } = {};
  const source = ts.transpileModule(readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies: Record<string, unknown> = { ...supabaseSessionDependencies,
    "next/server": { NextResponse },
    "@supabase/ssr": { createServerClient: () => ({ auth: { getClaims: async () => ({ data: null, error }) } }) },
  };
  vm.runInNewContext(source, { exports, require: (name: string) => dependencies[name], process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "project-key" } } });
  return (path: string) => exports.updateSession!(new NextRequest(`https://crm.test${path}`));
}

test("unavailable auth rejects APIs before execution with a retryable session response", async () => {
  for (const error of [{ name: "AuthRetryableFetchError", status: 503 }, { status: 409, code: "conflict" }]) {
    const response = await gate(error)("/api/ai/assistant");
    assert.equal(isWorkspaceSessionRetry(response, await response.json()), true);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("a page with temporarily unavailable auth reaches its authenticated loader without a false login redirect", async () => {
  const response = await gate({ name: "AuthRetryableFetchError", status: 503 })("/workflow");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("missing or invalid sessions still deny APIs and redirect staff pages to sign in", async () => {
  for (const error of [null, { status: 401, code: "bad_jwt" }]) {
    const read = gate(error);
    assert.equal((await read("/api/tasks")).status, 401);
    const response = await read("/workflow");
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("location")!).pathname, "/login");
  }
});

test("public signed workers remain reachable during a staff auth outage", async () => {
  const response = await gate({ name: "AuthRetryableFetchError", status: 503 })("/api/cron/mail-sync");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});
