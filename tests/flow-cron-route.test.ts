import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup(failWorkflow = false, preflight: { ready?: boolean; failure?: boolean; unavailableWorkspace?: boolean } = {}) {
  const background: Array<() => Promise<void>> = [];
  const calls: string[] = [];
  const errors: unknown[] = [];
  const dependencies: Record<string, unknown> = {
    "@/lib/data/workspace-runtime": { forEachWorkspace: async (run: (id: string, count: number) => Promise<unknown>, options?: { throwOnError?: boolean }) => {
      if (preflight.unavailableWorkspace) {
        assert.equal(options?.throwOnError, true, "readiness must not omit failed workspace checks");
        throw new Error("private provider details");
      }
      return [await run("test-workspace", 1)];
    } },
    "@/lib/data/flow-health": { checkWorkspaceFlowHealth: async () => {
      if (preflight.failure) throw new Error("private provider details");
      return { ready: preflight.ready ?? true, checks: [], mailboxes: [] };
    } },
    "next/server": { after: (run: () => Promise<void>) => background.push(run) },
    "@/lib/env": { env: { dryRun: true } },
    "@/lib/data/flow-runtime": { processDueFlowRuns: async () => { calls.push("flows"); if (failWorkflow) throw new Error("Database unavailable"); return []; } },
    "@/lib/data/email-delivery": { processScheduledEmails: async () => { calls.push("scheduled"); return 0; } },
    "@/lib/data/manual-email-send": { deliverEmail: async () => Response.json({}) },
    "@/lib/data/email-auto-reply-worker": { processEmailAutoReplies: async () => { calls.push("replies"); return 0; } },
    "@/lib/data/conversation-tagging": { processAutomaticConversationTags: async () => { calls.push("tags"); return {}; } },
  };
  const exports = {} as { GET: (request: Request) => Promise<Response> };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/cron/flows/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    Response, URL, Date, Error, process: { env: { CRON_SECRET: "test-secret" } }, console: { info() {}, error: (...args: unknown[]) => errors.push(args) } });
  const request = (task = "", authorized = true) => new Request(`https://crm.example.com/api/cron/flows${task}`, { headers: authorized ? { authorization: "Bearer test-secret" } : {} });
  return { ...exports, background, calls, errors, request };
}

test("cron rejects unauthenticated ticks and keeps health checks read-only", async () => {
  const app = setup();
  assert.equal((await app.GET(app.request("", false))).status, 401);
  assert.equal((await app.GET(app.request("?task=health"))).status, 200);
  assert.equal(app.background.length, 0);
  assert.deepEqual(app.calls, []);
});

test("cron acknowledges before starting work and isolates failed phases", async () => {
  const app = setup(true);
  const response = await app.GET(app.request());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, queued: true });
  assert.deepEqual(app.calls, []);
  await app.background[0]();
  assert.deepEqual(app.calls, ["flows"]);
  assert.equal(app.errors.length, 1);
});

test("readiness returns a failing HTTP status when a provider is unavailable", async () => {
  const app = setup(false, { ready: false });
  const response = await app.GET(app.request("?task=preflight"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ready, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(app.background.length, 0);
  assert.deepEqual(app.calls, []);
});

test("readiness cannot report success when a workspace or database check throws", async () => {
  for (const preflight of [{ failure: true }, { unavailableWorkspace: true }]) {
    const app = setup(false, preflight);
    const response = await app.GET(app.request("?task=preflight"));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ready, false);
    assert.equal(body.ok, false);
    assert.doesNotMatch(JSON.stringify(body), /private provider details/);
  }
});

test("ready providers pass the authenticated readiness check without enqueueing sends", async () => {
  const app = setup();
  assert.equal((await app.GET(app.request("?task=preflight", false))).status, 401);
  const response = await app.GET(app.request("?task=preflight"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ready, true);
  assert.equal(app.background.length, 0);
  assert.deepEqual(app.calls, []);
});
