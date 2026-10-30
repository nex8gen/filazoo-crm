import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup(secret: string | undefined = "fixture-secret") {
  let calls = 0;
  const background: Array<() => Promise<void>> = [];
  const exports = {} as { GET: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/cron/mail-sync/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Request, Response, URL, console, process: { env: { CRON_SECRET: secret } }, require: (name: string) => name === "next/server" ? { after: (run: () => Promise<void>) => background.push(run) } : { withMailSyncWorkerLease: async (run: () => Promise<unknown>) => run(), runMailSyncWorker: async () => { calls++; return { processed: 2, failed: 0 }; } } });
  return { ...exports, calls: () => calls, flush: async () => { for (const run of background) await run(); } };
}
test("public or incorrectly authenticated cron requests cannot touch the mailbox queue", async () => {
  for (const authorization of ["", "Bearer wrong"]) {
    const worker = setup();
    assert.equal((await worker.GET(new Request("https://crm.test/api/cron/mail-sync", { headers: { authorization } }))).status, 401);
    assert.equal(worker.calls(), 0);
  }
});
test("the existing cron bearer token invokes the receive worker independently of a viewer session", async () => {
  const worker = setup();
  const response = await worker.GET(new Request("https://crm.test/api/cron/mail-sync", { headers: { authorization: "Bearer fixture-secret" } }));
  assert.equal(response.status, 202);
  assert.equal(worker.calls(), 0, "the HTTP response must not wait for provider operations");
  assert.deepEqual(await response.json(), { ok: true, queued: true });
  await worker.flush();
  assert.equal(worker.calls(), 1);
});

test("the explicit receive-only diagnostic waits for its bounded result", async () => {
  const worker = setup();
  const response = await worker.GET(new Request("https://crm.test/api/cron/mail-sync?task=once", { headers: { authorization: "Bearer fixture-secret" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, processed: 2, failed: 0 });
  await worker.flush();
  assert.equal(worker.calls(), 1);
});

test("the session gate delegates mail sync authentication to its bearer guard while keeping staff pages gated", async () => {
  const exports = {} as { updateSession: (request: unknown) => Promise<{ status: number }> };
  const response = (status: number) => ({ status, cookies: { getAll: () => [], set() {} } });
  const dependencies = { "@supabase/ssr": { createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: null } }) } }) },
    "next/server": { NextResponse: { next: () => response(200), redirect: () => response(307) } } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, process: { env: { AUTH_REQUIRED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://db.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture" } }, require: (name: keyof typeof dependencies) => dependencies[name] });
  const request = (path: string) => ({ nextUrl: { pathname: path, search: "", clone: () => new URL(`https://crm.test${path}`) }, cookies: { getAll: () => [] } });
  assert.equal((await exports.updateSession(request("/api/cron/mail-sync"))).status, 200);
  assert.equal((await exports.updateSession(request("/emails"))).status, 307);
});
