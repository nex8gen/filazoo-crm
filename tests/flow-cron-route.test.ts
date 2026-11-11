import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup(failWorkflow = false) {
  const background: Array<() => Promise<void>> = [];
  const calls: string[] = [];
  const errors: unknown[] = [];
  const dependencies: Record<string, unknown> = {
    "@/lib/data/workspace-runtime": { forEachWorkspace: async (run: (id: string, count: number) => Promise<unknown>) => [await run("test-workspace", 1)] },
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
