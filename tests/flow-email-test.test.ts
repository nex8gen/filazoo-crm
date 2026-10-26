import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as engine from "../lib/flow-engine.ts";
import { blankStep, defaultFlowInput } from "../lib/flows.ts";
import { flowEmailTestSchema } from "../lib/flow-email-test.ts";

const require = createRequire(import.meta.url);
function moduleUnderTest(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? require(name), Response, Request, URL, Date, Error, console });
  return exports;
}
const payload = () => ({ flow: { ...defaultFlowInput, triggerType: "new_lead", triggerConfig: {}, steps: [
  { type: "wait", config: { amount: 5, unit: "minutes" } }, blankStep("ai_auto_reply"),
] }, firstMessage: true, emails: [{ from: "customer@example.com", subject: "PLA pricing", body: "Please send a catalog and pricing for black PLA." }] });
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/flows/test-email", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("sample email tests bound inputs and require a valid flow", () => {
  assert.equal(flowEmailTestSchema.safeParse(payload()).success, true);
  for (const input of [
    { ...payload(), emails: [] },
    { ...payload(), emails: Array(4).fill(payload().emails[0]) },
    { ...payload(), emails: [{ ...payload().emails[0], from: "invalid" }] },
    { ...payload(), emails: [{ ...payload().emails[0], body: " " }] },
    { ...payload(), emails: [{ ...payload().emails[0], body: "x".repeat(6001) }] },
  ]) assert.equal(flowEmailTestSchema.safeParse(input).success, false);
});

test("test-email endpoint rejects anonymous users, viewers, invalid input and foreign origins before generation", async () => {
  let executions = 0;
  const makeRoute = (role: string | null) => moduleUnderTest("../app/api/flows/test-email/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => role ? { role, displayName: "Manager" } : null },
    "@/lib/flow-email-test": { flowEmailTestSchema },
    "@/lib/data/flow-email-test": { testFlowWithEmails: async () => { executions++; return { cases: [] }; } },
  }).POST;
  assert.equal((await makeRoute(null)(request(payload())) as Response).status, 401);
  assert.equal((await makeRoute("viewer")(request(payload())) as Response).status, 403);
  assert.equal((await makeRoute("admin")(request(payload(), "https://untrusted.example")) as Response).status, 403);
  assert.equal((await makeRoute("operator")(request({ ...payload(), emails: [] })) as Response).status, 400);
  assert.equal(executions, 0);
  const response = await makeRoute("bd_manager")(request(payload())) as Response;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(executions, 1);
});

function service(failFirst = false) {
  const calls: Array<{ previousAutomatedMessages: number; messages: Array<{ direction: string; body: string }>; contact: { email: string } }> = [];
  let reads = 0;
  const exports = moduleUnderTest("../lib/data/flow-email-test.ts", {
    "../flow-engine.ts": engine,
    "./flow-ai-reply.ts": {
      loadFlowReplyProducts: async () => { reads++; return []; },
      generateFlowAiReply: async (input: typeof calls[number]) => {
        calls.push({ ...input, messages: [...input.messages] });
        if (failFirst && calls.length === 1) throw new Error("AI provider unavailable");
        return { subject: "Re: PLA pricing", body: "Please confirm your quantity.", attachments: input.previousAutomatedMessages === 0 ? [{ filename: "catalog.pdf", content: Buffer.from("%PDF") }] : [] };
      },
    },
  });
  return { run: exports.testFlowWithEmails, calls, reads: () => reads };
}

test("sample emails are separate test leads; waits do not delay generation and catalog contents never leave the server", async () => {
  const mock = service();
  const input = flowEmailTestSchema.parse({ ...payload(), emails: [payload().emails[0], { ...payload().emails[0], from: "second@example.com" }] });
  const result = await mock.run(input, "Manager") as { cases: Array<{ trace: Array<{ status: string }>; replies: Array<{ attachments: Array<{ filename: string; size: number; content?: unknown }> }> }> };
  assert.equal(result.cases.length, 2);
  assert.equal(mock.reads(), 1);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].previousAutomatedMessages, 0);
  assert.equal(mock.calls[1].previousAutomatedMessages, 0);
  assert.equal(mock.calls[1].contact.email, "second@example.com");
  assert.equal(result.cases[0].trace[0].status, "waiting");
  assert.equal(result.cases[0].replies[0].attachments[0].size, 4);
  assert.equal(result.cases[0].replies[0].attachments[0].content, undefined);
});

test("later-message tests and consecutive AI steps use the correct history and attachment count", async () => {
  const mock = service();
  const input = flowEmailTestSchema.parse({ ...payload(), firstMessage: false, flow: { ...payload().flow, steps: [blankStep("ai_auto_reply"), blankStep("ai_auto_reply")] } });
  const result = await mock.run(input, "Manager") as { cases: Array<{ replies: Array<{ attachments: unknown[] }> }> };
  assert.equal(mock.calls[0].previousAutomatedMessages, 1);
  assert.equal(mock.calls[1].previousAutomatedMessages, 2);
  assert.equal(mock.calls[1].messages[0].direction, "sent");
  assert.equal(result.cases[0].replies[0].attachments.length, 0);
});

test("stopped and skipped AI steps never invoke the provider", async () => {
  const mock = service();
  const input = flowEmailTestSchema.parse({ ...payload(), flow: { ...payload().flow, steps: [
    { type: "if_condition", config: { field: "opened_email", action: "continue", unmatchedAction: "skip_next" } },
    blankStep("ai_auto_reply"), { type: "stop", config: {} }, blankStep("ai_auto_reply"),
  ] } });
  await mock.run(input, null);
  assert.equal(mock.calls.length, 0);
  assert.equal(mock.reads(), 0);
});

test("provider failure is reported per sample while another sample can still be previewed", async () => {
  const mock = service(true);
  const input = flowEmailTestSchema.parse({ ...payload(), emails: [payload().emails[0], payload().emails[0]] });
  const result = await mock.run(input, null) as { cases: Array<{ error?: string; replies: unknown[] }> };
  assert.match(result.cases[0].error!, /provider unavailable/);
  assert.equal(result.cases[1].error, undefined);
  assert.equal(result.cases[1].replies.length, 1);
});

test("oversized multi-step tests stop before reading products or calling AI", async () => {
  const mock = service();
  const input = flowEmailTestSchema.parse({ ...payload(), emails: [payload().emails[0], payload().emails[0], payload().emails[0]], flow: { ...payload().flow, steps: [blankStep("ai_auto_reply"), blankStep("ai_auto_reply"), blankStep("ai_auto_reply")] } });
  await assert.rejects(() => mock.run(input, null), /six AI actions/);
  assert.equal(mock.calls.length, 0);
  assert.equal(mock.reads(), 0);
});
