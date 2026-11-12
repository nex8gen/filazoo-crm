import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture(failedPhase?: string, workspaceCount = 1) {
  const callbacks: Array<() => Promise<void>> = [];
  const calls: string[] = [];
  const failures: Array<{ phase: string }> = [];
  let flowOptions: { syncMailbox: boolean; budgetMs: number; actionDeadline: number } | undefined;
  const run = async (phase: string) => { calls.push(phase); if (phase === failedPhase) throw new Error(`Synthetic ${phase} failure`); return 1; };
  const dependencies: Record<string, unknown> = {
    "@/lib/data/workspace-runtime": { forEachWorkspace: async (run: (id: string, count: number) => Promise<unknown>) => [await run("test-workspace", workspaceCount)] },
    "next/server": { after: (callback: () => Promise<void>) => callbacks.push(callback) },
    "@/lib/env": { env: { dryRun: true } },
    "@/lib/data/flow-runtime": { processDueFlowRuns: async (_limit: number, options: typeof flowOptions) => { flowOptions = options; return run("workflows"); } },
    "@/lib/data/email-delivery": { processScheduledEmails: async (_deliver: unknown, options: { deadline: number }) => { assert.ok(options.deadline > Date.now()); return run("scheduled-email"); } },
    "@/lib/data/email-followups": { processEmailFollowups: async (options: { deadline: number }) => { assert.ok(options.deadline > Date.now()); return run("mailbox-followups"); } },
    "@/lib/data/manual-email-send": { deliverEmail: async () => { throw new Error("No direct delivery is permitted in this fixture"); } },
    "@/lib/data/email-auto-reply-worker": { processEmailAutoReplies: async (_mailbox: unknown, options: { deadline: number }) => { assert.ok(options.deadline > Date.now()); return run("automatic-replies"); } },
    "@/lib/data/conversation-tagging": { processAutomaticConversationTags: () => run("conversation-tags") },
  };
  const exports = {} as { GET: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/cron/flows/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; },
    Request, Response, URL, Date, process: { env: { CRON_SECRET: "test-secret" } }, console: { info() {}, error(_message: string, data: { phase: string }) { failures.push(data); } } });
  const request = (task = "", token = "test-secret") => new Request(`https://crm.test/api/cron/flows${task ? `?task=${task}` : ""}`, { headers: { authorization: `Bearer ${token}` } });
  return { ...exports, calls, failures, request, flowOptions: () => flowOptions, flush: async () => { for (const callback of callbacks) await callback(); } };
}

test("workflow cron rejects invalid credentials and health checks execute no work", async () => {
  const app = fixture();
  assert.equal((await app.GET(app.request("", "wrong"))).status, 401);
  const health = await app.GET(app.request("health"));
  assert.equal(health.status, 200);
  assert.equal((await health.json()).version, "flow-reliable-v4");
  await app.flush();
  assert.deepEqual(app.calls, []);
});

test("intake acknowledges promptly and only projects receipts and enrolls saved work", async () => {
  const app = fixture();
  const response = await app.GET(app.request());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, queued: true });
  assert.deepEqual(app.calls, []);
  await app.flush();
  assert.deepEqual(app.calls, ["workflows"]);
  assert.equal(app.flowOptions()?.syncMailbox, true);
  assert.equal(app.flowOptions()?.budgetMs, 60000);
});

test("provider workers run in separate invocations and retain attribution for failures", async () => {
  for (const phase of ["workflows", "scheduled-email", "automatic-replies"]) {
    const app = fixture(phase);
    assert.equal((await app.GET(app.request(phase === "workflows" ? "resume" : phase))).status, 202);
    await app.flush();
    assert.deepEqual(app.calls, phase === "scheduled-email" ? ["mailbox-followups", phase] : [phase]);
    assert.equal(app.failures.length, 1);
    assert.equal(app.failures[0].phase, phase);
  }
});

test("a mailbox follow-up failure does not prevent other scheduled emails", async () => {
  const app = fixture("mailbox-followups");
  await app.GET(app.request("scheduled-email")); await app.flush();
  assert.deepEqual(app.calls, ["mailbox-followups", "scheduled-email"]);
  assert.equal(app.failures[0].phase, "mailbox-followups");
});

test("the minute resume tick verifies receipts before processing saved work", async () => {
  const app = fixture();
  await app.GET(app.request("resume"));
  await app.flush();
  assert.equal(app.flowOptions()?.syncMailbox, true);
});

test("multiple workspaces share scheduling time without shrinking the action deadline below one email", async () => {
  const app = fixture(undefined, 2);
  await app.GET(app.request("resume"));
  await app.flush();
  assert.equal(app.flowOptions()?.budgetMs, 90_000);
  assert.ok(app.flowOptions()!.actionDeadline - Date.now() > 230_000);
});
