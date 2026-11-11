import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as checkModel from "../lib/flow-check.ts";
import * as tree from "../lib/flow-tree.ts";
import * as engine from "../lib/flow-engine.ts";
import * as mailboxes from "../lib/mailbox-utils.ts";
import * as senders from "../lib/flow-mailboxes.ts";
import * as segments from "../lib/segments.ts";
import * as model from "../lib/flows.ts";
import * as errors from "../lib/flow-execution-errors.ts";
import * as outreach from "../lib/outreach-policy.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";

type Row = Record<string, unknown>;
const id = "11111111-1111-4111-8111-111111111111";
const viewer = { id: "owner", role: "admin", workspaceId: "legacy" } as WorkspaceViewer;
function fixture(options: { smtpFailure?: Error; providerStatus?: number; missingEmail?: boolean } = {}) {
  const calls: string[] = [];
  const db: Record<string, Row[]> = {
    contacts: options.missingEmail ? [] : [{ id: "contact", company_id: "company", email: "customer@example.com", verification_status: "valid", unsubscribed: false }],
    flows: [{ id, user_id: "owner", trigger_config: {} }],
    workspace_mailboxes: [{ id: "sender", user_id: "owner", type: "personal", is_default: true, is_active: true, email: "owner@example.com", smtp_host: "smtp.example.com", smtp_port: 465, smtp_username: "owner", smtp_password: "private-password" }],
    workspace_members: [{ user_id: "specific-user", role: "operator", activated_at: "2026-01-01" }],
  };
  const admin = { from(table: string) {
    calls.push(`read:${table}`); let data = [...(db[table] || [])], single = false;
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { data = data.filter(row => row[key] === value); return query; },
      in(key: string, ids: unknown[]) { data = data.filter(row => ids.includes(row[key])); return query; },
      not() { return query; }, or() { return query; }, lt() { return query; }, limit() { return query; }, abortSignal() { return query; },
      maybeSingle() { single = true; return query; },
      throwOnError() { return query; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: single ? data[0] ?? null : data, count: 0, error: null }).then(resolve); },
    };
    return query;
  } };
  const dependencies: Record<string, unknown> = {
    "./flow-sender.ts": { assignedFlowCandidates: async () => ["owner"], assignedFlowActor: async () => "owner" },
    "../outreach-policy.ts": outreach,
    "server-only": {}, "../supabase/admin.ts": { createSupabaseAdmin: () => admin }, "../env.ts": { env: { dryRun: true, DAILY_SEND_LIMIT: 20, BOUNCE_PAUSE_PERCENT: 3 } },
    "../flow-tree.ts": tree, "../flow-engine.ts": engine, "../mailbox-utils.ts": mailboxes, "../flow-mailboxes.ts": senders,
    "../mailer.ts": { verifyMailboxSmtp: async () => { calls.push("smtp:verify"); if (options.smtpFailure) throw options.smtpFailure; } },
    "../ai/gateway-health.ts": { verifyGatewayAccess: async () => { calls.push("ai:access"); if (options.providerStatus && options.providerStatus !== 200) throw new Error(`AI Gateway access check failed (HTTP ${options.providerStatus})`); } },
    "./ai-settings.ts": { requireAiAutomation: async () => {} },
    "./flow-ai-reply.ts": { loadFlowReplyProducts: async () => [{ sku: "PLA", active: true }] },
    "./crm.ts": { listSegmentCompanies: async () => ({ companies: [{ id: "company", name: "Company", segment: "Wholesale", hasEmail: !options.missingEmail }] }) },
    "../segments.ts": segments, "./email-flows.ts": { validateEmailFlowScope: async () => {} },
    "../flows.ts": model, "../flow-execution-errors.ts": errors, "../flow-check.ts": checkModel,
  };
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(readFileSync(new URL("../lib/data/flow-check.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, AbortSignal, Promise, Date, Error, setTimeout, clearTimeout,
    fetch: async () => { calls.push("ai:access"); return Response.json({ balance: "1.00" }, { status: options.providerStatus || 200 }); },
  });
  const flow = model.flowInputSchema.parse({ name: "Original workflow", triggerType: "company_segment_changed", triggerConfig: { segment: "Wholesale", segmentAudience: true, reentryMode: "no_reentry" }, status: "live", steps: model.stepTypes.map(type => { const step = model.blankStep(type); if (type === "send_email") step.config.templateId = "welcome_intro"; return step; }) });
  return { check: exports.checkFlow as (input: checkModel.FlowCheckInput, user: WorkspaceViewer) => Promise<checkModel.FlowCheckResult>, flow, calls, db };
}

test("quick checks cover all action types and authenticate dependencies without sending or writing", async () => {
  const app = fixture();
  const report = await app.check({ flow: app.flow, flowId: id }, viewer);
  assert.equal(report.status, "ready");
  assert.equal(report.actionCount, 10);
  assert.ok(app.calls.includes("smtp:verify"));
  assert.ok(app.calls.includes("ai:access"));
  assert.ok(app.calls.includes("read:crm_tasks"));
  assert.ok(app.calls.includes("read:internal_notifications"));
  assert.ok(report.checks.some(check => check.id === "sending" && check.status === "warning"));
  assert.ok(!JSON.stringify(report).includes("private-password"));
  assert.ok(!JSON.stringify(report).includes("private-token"));
});

test("AI authentication failure and absent recipients cannot produce a green result", async () => {
  for (const options of [{ providerStatus: 401 }, { missingEmail: true }]) {
    const app = fixture(options);
    const report = await app.check({ flow: app.flow }, viewer);
    assert.equal(report.status, "blocked");
    assert.ok(report.checks.some(check => check.status === "blocked"));
    if (options.missingEmail) assert.equal(report.checks.find(check => check.id === "audience")?.links?.[0].href, "/companies/company");
  }
});

test("a timed-out mail server remains unverified instead of passing", async () => {
  const app = fixture({ smtpFailure: new Error("SMTP check timed out") });
  const result = await app.check({ flow: app.flow }, viewer);
  assert.equal(result.status, "incomplete");
  assert.equal(result.checks.find(check => check.id === "senders")?.status, "unverified");
});

test("a read-only teammate cannot probe another owner's personal sender", async () => {
  const app = fixture();
  await assert.rejects(() => app.check({ flow: app.flow, flowId: id }, { ...viewer, id: "other", role: "viewer" }), /owner or an administrator/);
  assert.equal(app.calls.includes("smtp:verify"), false);
});
