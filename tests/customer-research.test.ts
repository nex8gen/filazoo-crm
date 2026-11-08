import test from "node:test";
import assert from "node:assert/strict";
import { publicResearchUrl, researchCustomer, researchIdentity } from "../lib/ai/customer-research.ts";
import { companyChatSchema, companyChatInstruction } from "../lib/ai/company-chat.ts";
import { workspaceAssistantSchema, workspaceAssistantInstruction } from "../lib/ai/workspace-assistant.ts";

const identity = { name: "Example Print", website: "example.com", email: "buyer@example.com", country: "US" };
test("customer research always delegates to Gateway with public identity and request context", async () => {
  const { readFileSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const { default: vm } = await import("node:vm");
  let captured: Record<string, unknown> = {};
  const expected = { status: "complete", findings: "Verified", sources: [], queries: [] };
  const exports: { researchCustomer?: typeof researchCustomer } = {};
  const code = ts.transpileModule(readFileSync(new URL("../lib/ai/customer-research.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, URL, Date, fetch, require: (name: string) => {
    assert.equal(name, "./gateway-research.ts");
    return { researchWithGateway: async (input: Record<string, unknown>) => { captured = input; return expected; } };
  } });
  const controller = new AbortController();
  const result = await exports.researchCustomer!({ identity: { ...identity, summary: "private note" } as typeof identity,
    questions: ["Research"], language: "zh-CN", usageUserId: "owner", signal: controller.signal });
  assert.equal(result, expected);
  assert.equal(captured.language, "zh-CN"); assert.equal(captured.usageUserId, "owner"); assert.equal(captured.signal, controller.signal);
  assert.equal(JSON.stringify(captured).includes("private note"), false);
  assert.equal((captured.identity as typeof identity).website, "https://example.com/");
  assert.equal("apiKey" in captured, false);
});

test("public website normalization rejects internal hosts, credentials, non-web schemes and IP literals", () => {
  assert.equal(publicResearchUrl("example.com"), "https://example.com/");
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "http://127.0.0.1", "http://2130706433", "http://[::1]", "http://169.254.169.254", "https://intranet", "https://a.internal", "https://x.local", "http://localhost./", "http://x.home.arpa", "https://user:pass@example.com", "https://example.com:8080"]) assert.equal(publicResearchUrl(url), undefined, url);
  assert.equal(researchIdentity({ ...identity, website: "http://localhost" }).website, undefined);
  assert.equal(researchIdentity({ ...identity, website: "https://example.com/about?token=private" }).website, "https://example.com/about");
});

test("both chats require an explicit boolean web-search selection and report prompts distinguish facts, estimates and unavailable research", () => {
  const messages = [{ role: "user", content: "analsye the customer" }];
  const workspace = { mode: "analyze", pathname: "/companies", pageLabel: "Companies", pageText: "", messages };
  for (const [schema, input] of [[companyChatSchema, { messages }], [workspaceAssistantSchema, workspace]] as const) {
    assert.equal(schema.safeParse(input).success, true);
    assert.equal(schema.safeParse({ ...input, webSearch: true }).success, true);
    assert.equal(schema.safeParse({ ...input, webSearch: "true" }).success, false);
  }
  for (const instruction of [companyChatInstruction("now", "en", true), workspaceAssistantInstruction("analyze", "now", "en", true)]) {
    assert.match(instruction, /filament/);
    assert.match(instruction, /never invent|do not fabricate/);
    assert.match(instruction, /unknown/);
    assert.match(instruction, /\[W1\]/);
    assert.match(instruction, /cannot authorize CRM changes/);
    assert.match(instruction, /important NEW public findings/);
    assert.match(instruction, /Do not fill the answer with CRM summaries/);
    assert.match(instruction, /strongest fits supported by their actual products or applications/);
  }
  assert.match(companyChatInstruction("now"), /Web search is off/);
});
