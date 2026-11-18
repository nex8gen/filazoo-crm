import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as performance from "../lib/flow-email-performance.ts";
import * as analytics from "../lib/flow-analytics.ts";
import { applyFlowUtm } from "../lib/flow-email-utm.ts";
import { buildFlowEmail } from "../lib/flow-tracking.ts";
import { newEmailDesign } from "../lib/email-design.ts";
import { blankStep, cloneFlowStep, defaultFlowInput, stepConfigSchemas, withFlowEmailIdentities } from "../lib/flows.ts";

const now = new Date("2026-11-17T12:00:00Z");
const log = (id: string, runId: string, action: string, stepId = "email"): performance.EmailPerformanceLog => ({ id, run_id: runId, created_at: "2026-11-15T12:00:00Z", result: { action, stepId } });
test("email rates count unique messages from the 30-day sending cohort, including nested action IDs", () => {
  const logs = [log("s1", "r1", "email_sent"), log("duplicate-send", "r1", "email_sent"), log("s2", "r2", "email_sent"), log("o1", "r1", "email_opened"), log("o2", "r1", "email_opened"), log("c1", "r1", "link_clicked"), log("c2", "r1", "link_clicked"), log("no-send", "old-run", "email_opened"), log("dry", "r3", "email_dry_run"), log("skip", "r4", "email_skipped"), log("nested-send", "r5", "email_sent", "nested-email"), { ...log("old", "r6", "email_sent"), created_at: "2026-08-01T00:00:00Z" }];
  const report = performance.summarizeEmailPerformance([...logs, logs[0]], [], now);
  assert.equal(report.from, "2026-10-19T00:00:00.000Z");
  assert.deepEqual(report.actions.email, { sent: 2, opens: 1, clicks: 1, openRate: 50, clickRate: 50, skipped: 1, waiting: 0, review: 0 });
  assert.equal(report.actions["nested-email"].sent, 1);
  assert.equal(performance.emailRate(53.846153, 7), "53.8% (7)");
  assert.equal(performance.emailRate(null, 0), "—");
});

test("waiting and review use durable branch cursors, ignore completed sends, and never guess root indices", () => {
  const definition = JSON.stringify([{ id: "wait" }, { id: "nested-email" }]);
  const waiting: performance.EmailPerformanceRun = { id: "waiting", status: "active", current_step: 1, context: { definition, executionCheckpoint: { stepId: "wait" } } };
  const blocked: performance.EmailPerformanceRun = { id: "blocked", status: "active", current_step: 0, context: { preparationRetry: { stepId: "nested-email" }, executionState: "blocked" } };
  const failed: performance.EmailPerformanceRun = { id: "failed", status: "failed", current_step: 1, context: { definition } };
  const sent = { ...waiting, id: "sent" };
  const report = performance.summarizeEmailPerformance([log("sent", "sent", "email_sent", "nested-email")], [waiting, waiting, blocked, failed, sent, { ...waiting, id: "unknown", context: null }], now);
  assert.equal(report.actions["nested-email"].waiting, 1);
  assert.equal(report.actions["nested-email"].review, 2);
  assert.equal(report.actions.wait, undefined);
});

function serviceFixture(options: { missing?: boolean; denied?: boolean; truncate?: boolean } = {}) {
  const logs = Array.from({ length: 1001 }, (_, index) => log(`l${index}`, `r${index}`, "email_sent"));
  const requests: Array<{ table: string; from: number; to: number }> = [];
  const client = { from(table: string) {
    const query = { select() { return query; }, eq() { return query; }, in() { return query; }, or() { return query; }, gte() { return query; }, lte() { return query; }, order() { return query; }, maybeSingle() { return Promise.resolve({ data: options.missing ? null : { id: "flow", trigger_config: options.denied ? { flowScope: "email" } : {} }, error: null }); }, range(from: number, to: number) {
      requests.push({ table, from, to });
      const rows = table === "flow_run_logs" ? logs : [];
      return Promise.resolve({ data: options.truncate && from >= 500 ? [] : rows.slice(from, to + 1), count: rows.length, error: null });
    } };
    return query;
  } };
  const output: Record<string, (...args: unknown[]) => Promise<performance.EmailPerformanceReport>> = {};
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-email-performance.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies: Record<string, unknown> = { "server-only": {}, "./flow-ai-cost.ts": { reconcileFlowAiCosts: async () => {} }, "../auth.ts": { requireWorkspaceMember: async () => ({ id: "viewer", role: "viewer" }) }, "../supabase/admin.ts": { createSupabaseAdmin: () => client }, "./email-flows.ts": { validateEmailFlowScope: async () => { if (options.denied) throw new Error("Access denied."); } }, "../flow-analytics.ts": analytics, "../flow-email-performance.ts": performance };
  vm.runInNewContext(code, { exports: output, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; } });
  return { service: output, client, requests };
}

test("the metrics query reads every page and rejects incomplete totals", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.readEmailPerformance(fixture.client, "flow", now);
  assert.equal(result.actions.email.sent, 1001);
  assert.deepEqual(fixture.requests.filter(query => query.table === "flow_run_logs").map(query => query.from), [0, 500, 1000]);
  const broken = serviceFixture({ truncate: true });
  await assert.rejects(broken.service.readEmailPerformance(broken.client, "flow", now), /completely/);
});

test("missing and inaccessible scoped workflows fail before reading their logs", async () => {
  for (const options of [{ missing: true }, { denied: true }]) {
    const fixture = serviceFixture(options);
    await assert.rejects(fixture.service.getEmailPerformance("flow"), /not found|Access denied/);
    assert.equal(fixture.requests.length, 0);
  }
});

test("custom UTM settings persist and reach both text and designed email links", () => {
  const config = { ...defaultFlowInput.steps[1].config, trackClicks: false, trackOpens: false, useCustomUtm: true, utmParameters: { utm_source: "newsletter", utm_medium: "email", utm_campaign: "WELCOME 10", utm_content: "first email" } };
  assert.equal(stepConfigSchemas.send_email.safeParse(config).success, true);
  assert.equal(stepConfigSchemas.send_email.safeParse({ ...config, utmParameters: { ...config.utmParameters, utm_campaign: "" } }).success, false);
  for (const design of [undefined, newEmailDesign('<html><body><a href="https://example.com/">Welcome</a></body></html>', "html")]) {
    const result = buildFlowEmail({ body: "Welcome https://example.com/", config: { ...config, ...(design ? { emailDesign: design } : {}) }, runId: "run", stepId: "email", flowId: "flow", appUrl: "https://crm.example.com", secret: "test" });
    const href = /href="([^"]+)"/.exec(result.html)![1].replaceAll("&amp;", "&");
    const url = new URL(href);
    assert.equal(url.searchParams.get("utm_source"), "newsletter");
    assert.equal(url.searchParams.get("utm_campaign"), "WELCOME 10");
    assert.equal(url.searchParams.get("utm_content"), "first email");
  }
  assert.equal(applyFlowUtm(new URL("https://example.com/"), { ...config, utmTracking: false }, "flow").search, "");
});

test("saving after root row IDs change retains email metrics identities, while copies get independent identities", () => {
  const first = withFlowEmailIdentities(defaultFlowInput);
  assert.equal(first.steps[1].config.performanceId, defaultFlowInput.steps[1].id);
  assert.equal(defaultFlowInput.steps[1].config.performanceId, undefined, "Normalization must not mutate a shared template");
  const second = withFlowEmailIdentities({ ...first, steps: first.steps.map(step => ({ ...step, id: `new-${step.id}` })) });
  assert.equal(second.steps[1].config.performanceId, first.steps[1].config.performanceId);
  const copy = withFlowEmailIdentities({ ...second, steps: [cloneFlowStep(second.steps[1])] });
  assert.notEqual(copy.steps[0].config.performanceId, first.steps[1].config.performanceId);
  const send = { ...log("sent-stable", "run", "email_sent", "old-row-id"), result: { action: "email_sent", stepId: "old-row-id", performanceId: "stable-email" } };
  const opened = log("opened-stable", "run", "email_opened", "stable-email");
  const run: performance.EmailPerformanceRun = { id: "waiting", status: "active", current_step: 0, context: { definition: JSON.stringify([{ id: "new-row-id", config: { performanceId: "stable-email" } }]) } };
  const report = performance.summarizeEmailPerformance([send, opened], [run], now);
  assert.equal(report.actions["stable-email"].sent, 1);
  assert.equal(report.actions["stable-email"].openRate, 100);
  assert.equal(report.actions["stable-email"].waiting, 1);
  assert.equal(report.actions["old-row-id"], undefined);
});

test("AI spend is cumulative, counts retries once, and preserves unknown and historical costs", () => {
  const usage = (id: string, generation: string | null, cost: number | null, step = "ai") => ({ ...log(id, id, "ai_usage", step), result: { action: "ai_usage", stepId: step, generationId: generation, costUsd: cost } });
  const known = usage("known", "gen_1", .12);
  const old = { ...usage("old-usage", "gen_old", .03), created_at: "2026-07-01T00:00:00Z" };
  const duplicate = { ...usage("duplicate", "gen_1", null), run_id: "known" };
  const untracked = { ...log("legacy", "old-run", "email_sent", "legacy-ai"), result: { action: "email_sent", stepId: "legacy-ai", aiGenerated: true } };
  const report = performance.summarizeEmailPerformance([duplicate, known, known, old, usage("pending", "gen_pending", null), untracked, usage("failed", null, null, "failed-ai")], [], now);
  assert.equal(report.costs!.ai.recordedUsd, .15);
  assert.equal(report.costs!.ai.requests, 3);
  assert.equal(report.costs!.ai.pending, 1);
  assert.equal(performance.emailAiSpend(report.costs!.ai), "$0.15+");
  assert.equal(performance.emailAiSpend(report.costs!["legacy-ai"]), "Not recorded");
  assert.equal(performance.emailAiSpend(report.costs!["failed-ai"]), "Not recorded");
  assert.equal(performance.emailAiSpend({ recordedUsd: .0000001, requests: 1, pending: 0, untracked: false }), "<$0.0001");
  assert.equal(report.actions.ai, undefined, "Billing attempts are not sent emails");
});

test("AI action identities and draft status survive edits, including nested copies", () => {
  const ai = blankStep("ai_auto_reply");
  const first = withFlowEmailIdentities({ ...defaultFlowInput, steps: [ai] });
  const id = first.steps[0].config.performanceId;
  const edited = withFlowEmailIdentities({ ...first, steps: [{ ...first.steps[0], id: "replacement-row" }] });
  assert.equal(edited.steps[0].config.performanceId, id);
  assert.equal(stepConfigSchemas.ai_auto_reply.parse({ ...edited.steps[0].config, emailStatus: "draft" }).performanceId, id);
  assert.notEqual(withFlowEmailIdentities({ ...first, steps: [cloneFlowStep(first.steps[0])] }).steps[0].config.performanceId, id);
  const split = blankStep("split");
  split.config.paths = [{ id: "otherwise", condition: null, steps: first.steps }];
  const nested = cloneFlowStep(split).config.paths as Array<{ steps: Array<{ config: Record<string, unknown> }> }>;
  assert.equal(nested[0].steps[0].config.performanceId, undefined);
});
