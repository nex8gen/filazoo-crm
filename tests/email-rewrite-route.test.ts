import { policyTestDependency } from "./helpers/ai-policy.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as rewrite from "../lib/ai/email-rewrite.ts";
import { aiLanguageSchema } from "../lib/ai/language.ts";

const code = ts.transpileModule(readFileSync(new URL("../app/api/email/assist/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

for (const provider of ["gemini", "gateway", "regional-fallback"] as const) {
  for (const language of ["en", "zh-CN"] as const) {
    for (const text of ["Please send the catalog for 500 spools of PLA.", "请发送500卷PLA的产品目录。", "请发送 catalog for 500 spools of PLA."]) {
      test(`${provider} rewrites ${language} drafts in English: ${text}`, async () => {
        const calls: { systemInstruction: string; prompt: string }[] = [];
        const generate = async (input: { systemInstruction: string; prompt: string }) => {
          calls.push(input);
          return "Hi Isaac,\n\nHere is our catalog for 500 spools of PLA.\n\n顺祝商祺\nWrong manager";
        };
        const dependencies: Record<string, unknown> = {
          "@/lib/auth": { requireWorkspaceMember: async () => ({ displayName: "Unassigned" }) },
          "@/lib/ai/gemini": { generateGeminiText: provider === "regional-fallback"
            ? async () => { throw new Error("region unavailable"); } : generate },
          "@/lib/ai/gateway": { generateGatewayText: generate, isGeminiRegionError: () => true },
          "@/lib/ai/email-rewrite": rewrite,
          "@/lib/email-translation": {},
          "@/lib/ai/language": { aiLanguageSchema },
          "@/lib/ai/email-summary": {},
          zod: { z },
        };
        const exports = {} as { POST: (request: Request) => Promise<Response> };
        vm.runInNewContext(code, {
          exports,
          require: (name: string) => { const aiDependency = policyTestDependency(name); if (aiDependency) return aiDependency;
            assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
            return dependencies[name];
          },
          Response,
          process: { env: provider === "gemini" ? { GEMINI_API_KEY: "test-key" }
            : provider === "gateway" ? { AI_GATEWAY_API_KEY: "test-token" }
            : { GEMINI_API_KEY: "test-key", AI_GATEWAY_API_KEY: "test-token" } },
        });
        const response = await exports.POST(new Request("http://localhost/api/email/assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "rewrite", language, text, recipient: "Isaac" }),
        }));
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.provider, provider === "gemini" ? "gemini" : "vercel-ai-gateway");
        assert.equal(result.output, "Hi Isaac,\n\nHere is our catalog for 500 spools of PLA.\n\nBest regards,\n\nFilazoo Sales Team\nBD Sales Manager\nFilazoo");
        assert.equal(calls.length, 1);
        assert.match(calls[0].systemInstruction, /Always write the entire finished email in professional English/);
        assert.doesNotMatch(calls[0].systemInstruction, /Simplified Chinese|顺祝商祺|商务拓展经理/);
        assert.ok(calls[0].prompt.includes(text));
      });
    }
  }
}
