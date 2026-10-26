import assert from "node:assert/strict";
import test from "node:test";
import { aiLanguageSchema } from "../lib/ai/language.ts";
import { companyChatInstruction, companyChatSchema } from "../lib/ai/company-chat.ts";
import { workspaceAssistantInstruction, workspaceAssistantSchema } from "../lib/ai/workspace-assistant.ts";
import { buildEmailReplyInstruction } from "../lib/ai/email-reply.ts";
import { applyEmailSignature, buildEmailRewriteInstruction } from "../lib/ai/email-rewrite.ts";
import { buildEmailSummaryInstruction, generateEmailSummary } from "../lib/ai/email-summary.ts";
import { runMockProfileAgent } from "../lib/ai/mock-agent.ts";
import { readFileSync } from "node:fs";

const now = "2026-10-26T02:00:00.000Z";
const signature = { name: "Casey", title: "商务拓展经理", company: "Filazoo" };

test("every AI instruction prioritizes the selected Chinese UI language over English input and history", () => {
  const instructions = [companyChatInstruction(now, "zh-CN"), workspaceAssistantInstruction("analyze", now, "zh-CN"), workspaceAssistantInstruction("work", now, "zh-CN"), buildEmailReplyInstruction("zh-CN"), buildEmailRewriteInstruction(signature, "zh-CN"), buildEmailSummaryInstruction("zh-CN")];
  for (const instruction of instructions) {
    assert.match(instruction, /professional Simplified Chinese/);
    assert.match(instruction, /even when.*English/);
    assert.match(instruction, /JSON keys and enum values exactly/);
    assert.doesNotMatch(instruction, /Use English\.|professional English|language of the latest|customer's language/);
  }
});

test("chat schemas accept Chinese selection and reject unsupported languages without breaking older clients", () => {
  const messages = [{ role: "user", content: "Summarize this customer in one sentence." }];
  assert.equal(companyChatSchema.parse({ language: "zh-CN", messages }).language, "zh-CN");
  const page = { mode: "analyze", pathname: "/companies", pageLabel: "Companies", pageText: "", messages };
  assert.equal(workspaceAssistantSchema.parse({ ...page, language: "zh-CN" }).language, "zh-CN");
  assert.equal(companyChatSchema.parse({ messages }).language, "en");
  assert.equal(aiLanguageSchema.safeParse("fr").success, false);
});

test("Chinese email signatures replace both Chinese and English signoffs and preserve the assigned manager", () => {
  const expected = "您好，已收到您的咨询。\n\n顺祝商祺\n\nCasey\n商务拓展经理\nFilazoo";
  assert.equal(applyEmailSignature("您好，已收到您的咨询。\n\nBest regards,\nWrong manager", signature, "zh-CN"), expected);
  assert.equal(applyEmailSignature(expected, signature, "zh-CN"), expected);
  assert.match(applyEmailSignature("Hello", signature, "en"), /Best regards,/);
});

test("structured summary repair keeps Chinese follow-up explanations and valid machine-readable dates", async () => {
  let calls = 0;
  const result = await generateEmailSummary(async () => {
    calls++;
    return calls === 1 ? "invalid JSON" : JSON.stringify({ title: "待跟进咨询", summary: "客户需要报价。", nextStep: "确认数量。", followUpAt: "2026-10-20T01:00:00.000Z", followUpReason: "请尽快回复。" });
  }, () => new Date(now), "zh-CN");
  const summary = JSON.parse(result);
  assert.equal(calls, 2);
  assert.match(summary.followUpReason, /北京时间/);
  assert.ok(Date.parse(summary.followUpAt) > Date.parse(now));
  assert.equal(summary.title, "待跟进咨询");
});

test("mock profiling also supports Chinese descriptions and preserves source evidence", () => {
  const websiteSummary = "一家从事工业 3D 打印、工程原型设计及批量生产的制造企业。";
  const profile = runMockProfileAgent({ companyName: "Example Studio", websiteSummary, language: "zh-CN" });
  assert.match(profile.summary, /Example Studio.*相关性/);
  assert.equal(profile.productsTheyPrint, "原型及功能性零件");
  assert.deepEqual(profile.evidence, [websiteSummary]);
  assert.ok(profile.fitScore >= 8);
});

test("AI clients pass language selection and both email provider paths use localized instructions", () => {
  for (const file of ["components/company-ai.tsx", "components/workspace-ai-assistant.tsx", "components/email-inbox.tsx", "components/email-ai-summary.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /useLanguage\(\)/, file);
    assert.match(source, /JSON\.stringify\([\s\S]*?\blanguage\b/, file);
  }
  for (const file of ["app/api/email/assist/route.ts", "app/api/email/reply/route.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /language: aiLanguageSchema/, file);
    assert.match(source, /buildEmail(?:Reply|Rewrite|Summary)Instruction\([^)]*language/, file);
  }
});
