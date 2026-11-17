import assert from "node:assert/strict";
import test from "node:test";
import { blankStep, defaultFlowInput, type FlowInput, type JsonConfig } from "../lib/flows.ts";
import { flowConnectorHealth, readFlowRuntimeIssue, readFlowRuntimeIssues } from "../lib/flow-connector-health.ts";
import type { FlowCheckResult } from "../lib/flow-check.ts";

const live = (): FlowInput => ({ ...structuredClone(defaultFlowInput), status: "live" });
const ready: FlowCheckResult = { status: "ready", checkedAt: "2026-11-17T00:00:00Z", durationMs: 20, actionCount: 3, checks: [{ id: "senders", label: "Senders", status: "passed", detail: "Authenticated" }] };
const evidence = { checks: ready, runtimeIssue: null };
const withCheck = (id: string, status: "blocked" | "unverified" | "warning") => ({ ...evidence, checks: { ...ready, checks: [{ id, status, label: id, detail: `${id} needs attention` }] } });

test("only a saved, verified live definition gets moving blue connectors", () => {
  assert.equal(flowConnectorHealth(live(), evidence).state, "live");
  assert.equal(flowConnectorHealth(live()).state, "unknown");
  assert.equal(flowConnectorHealth(live(), { checks: ready }).state, "unknown");
  assert.equal(flowConnectorHealth(live(), { runtimeIssue: null }).state, "unknown");
  assert.equal(flowConnectorHealth(live(), evidence, undefined, false).state, "unknown");
  for (const status of ["draft", "paused"] as const) assert.equal(flowConnectorHealth({ ...live(), status }, evidence).state, "idle");
});

test("missing settings inside a nested action turn a live workflow red immediately", () => {
  const flow = live();
  const split = blankStep("split");
  split.config.paths = [{ id: "match", name: "Matches", condition: { field: "customer_replied" }, steps: [{ ...blankStep("create_task"), config: { title: "" } }] }, { id: "else", name: "Everyone else", condition: null, steps: [] }] as unknown as JsonConfig["paths"];
  flow.steps = [split];
  assert.equal(flowConnectorHealth(flow, evidence).state, "error");
  assert.equal(flowConnectorHealth(flow, undefined, undefined, false).state, "error");
});

test("known blockers override Live and remain red when another health source is unavailable", () => {
  assert.equal(flowConnectorHealth(live(), { ...evidence, runtimeIssue: "SMTP authentication failed" }).state, "error");
  assert.equal(flowConnectorHealth(live(), withCheck("senders", "blocked")).state, "error");
  assert.equal(flowConnectorHealth(live(), { ...withCheck("ai", "blocked"), readError: "Run history unavailable" }).state, "error");
  assert.equal(flowConnectorHealth(live(), evidence, "Saved audience was deleted").state, "error");
  assert.equal(flowConnectorHealth(live(), withCheck("queue", "warning")).state, "error");
});

test("disabled live sending is a known blocker and must turn connectors red", () => {
  const flow = live();
  const health = flowConnectorHealth(flow, withCheck("sending", "warning"));
  assert.equal(health.state, "error");
  assert.match(health.message, /delivery.*unavailable/i);
  assert.equal(health.actions?.[flow.steps[1].id!].state, "error");
  assert.equal(health.actions?.[flow.steps[0].id!].state, "live");
  assert.equal(health.actions?.[flow.steps[2].id!].state, "live");
});

test("a malformed nested action does not mark its healthy split or other path red", () => {
  const flow = live(), split = blankStep("split"), bad = blankStep("create_task"), good = blankStep("stop");
  bad.config.title = "";
  split.config.paths = [{ id: "yes", name: "Matches", condition: { field: "customer_replied" }, steps: [bad] }, { id: "no", name: "Everyone else", condition: null, steps: [good] }] as unknown as JsonConfig["paths"];
  flow.steps = [split];
  const health = flowConnectorHealth(flow, evidence);
  assert.equal(health.actions?.[bad.id!].state, "error");
  assert.equal(health.actions?.[good.id!].state, "live");
  assert.equal(health.actions?.[split.id!].state, "live");
});

test("a sender issue with an action path does not mark another email action red", () => {
  const flow = live();
  const other = { ...structuredClone(flow.steps[1]), id: "other-email" };
  flow.steps.push(other);
  const health = flowConnectorHealth(flow, { ...evidence, checks: { ...ready, checks: [{ id: "senders", label: "Sender", status: "blocked", detail: "One sender failed", actionPaths: [[3]] }] } });
  assert.equal(health.actions?.[other.id].state, "error");
  assert.equal(health.actions?.[flow.steps[1].id!].state, "live");
});

test("failed run identities are retained across every page without guessing root positions", async () => {
  const fetcher = mockRuns({
    "failed:0": { runs: [{ status: "failed", currentActionId: "nested-email", flow_run_logs: [{ error: "SMTP failed", created_at: "2026-11-17" }] }], hasMore: true },
    "failed:1": { runs: [{ status: "failed", flow_run_logs: [{ error: "Unattributed failure", created_at: "2026-11-17" }] }] },
    "active:0": { runs: [{ status: "active", retry: { stepId: "task", reason: "User unavailable" } }] },
  });
  assert.deepEqual(await readFlowRuntimeIssues("flow", new AbortController().signal, fetcher), [{ actionId: "nested-email", message: "SMTP failed" }, { actionId: null, message: "Unattributed failure" }, { actionId: "task", message: "User unavailable" }]);
});

test("unverified services cannot claim a healthy live workflow", () => {
  assert.equal(flowConnectorHealth(live(), withCheck("senders", "unverified")).state, "unknown");
  assert.equal(flowConnectorHealth(live(), { ...evidence, readError: "Timed out" }).state, "unknown");
  assert.equal(flowConnectorHealth(live(), withCheck("audience", "warning")).state, "live");
});

function mockRuns(pages: Record<string, { runs: unknown[]; hasMore?: boolean }>, calls: string[] = []): typeof fetch {
  return (async (input) => {
    const url = new URL(String(input), "https://crm.example");
    const key = `${url.searchParams.get("status")}:${url.searchParams.get("page")}`;
    calls.push(key);
    assert.ok(pages[key], `Unexpected health page ${key}`);
    return Response.json({ ok: true, ...pages[key] });
  }) as typeof fetch;
}

test("a blocked action beyond the first active page is detected", async () => {
  const calls: string[] = [];
  const fetcher = mockRuns({ "failed:0": { runs: [] }, "active:0": { runs: Array.from({ length: 25 }, () => ({ status: "active", retry: null })), hasMore: true }, "active:1": { runs: [{ status: "active", retry: { reason: "AI credentials unavailable" } }] } }, calls);
  assert.equal(await readFlowRuntimeIssue("flow", new AbortController().signal, fetcher), "AI credentials unavailable");
  assert.deepEqual(calls, ["failed:0", "active:0", "active:1"]);
});

test("normal scheduled waits and recovered active runs are healthy", async () => {
  const fetcher = mockRuns({ "failed:0": { runs: [] }, "active:0": { runs: [{ status: "active", retry: null, flow_run_logs: [{ error: "An old, recovered failure", created_at: "2026-11-16" }] }] } });
  assert.equal(await readFlowRuntimeIssue("flow", new AbortController().signal, fetcher), null);
});

test("unresolved failed runs and uncertain deliveries are reported", async () => {
  const failed = mockRuns({ "failed:0": { runs: [{ status: "failed", flow_run_logs: [{ error: "Email action failed", created_at: "2026-11-17" }] }] } });
  assert.equal(await readFlowRuntimeIssue("flow", new AbortController().signal, failed), "Email action failed");
  const uncertain = mockRuns({ "failed:0": { runs: [] }, "active:0": { runs: [{ status: "active", uncertain: true }] } });
  assert.match((await readFlowRuntimeIssue("flow", new AbortController().signal, uncertain))!, /could not be confirmed/);
});

test("failed or incomplete history reads never return a healthy result", async () => {
  const incomplete = mockRuns({ "failed:0": { runs: [] }, "active:0": { runs: [], hasMore: true } });
  await assert.rejects(readFlowRuntimeIssue("flow", new AbortController().signal, incomplete), /completely/);
  const denied = (async () => Response.json({ ok: false, error: "Access denied" }, { status: 403 })) as typeof fetch;
  await assert.rejects(readFlowRuntimeIssue("flow", new AbortController().signal, denied), /Access denied/);
});
