import { policyTestDependency } from "./helpers/ai-policy.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as reply from "../lib/ai/email-reply.ts";
import * as rewrite from "../lib/ai/email-rewrite.ts";
import { aiLanguageSchema } from "../lib/ai/language.ts";
import * as invoicePermissions from "../lib/invoice-permissions.ts";

const code = ts.transpileModule(readFileSync(new URL("../app/api/email/reply/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

for (const provider of ["gateway", "oidc", "legacy-budget"] as const) {
  for (const language of ["en", "zh-CN", undefined] as const) {
    test(`${provider} generates English replies with ${language ?? "legacy"} interface selection`, async () => {
      const calls: { systemInstruction: string; prompt: string }[] = [];
      const body = "Dear David,\n\nThank you for the updated billing address for order #1297. Our catalog is attached.";
      const generate = async (input: { systemInstruction: string; prompt: string }) => {
        calls.push(input);
        return JSON.stringify({ body: `${body}\n\n祝好，\nFilazoo 团队`, attachCatalog: true, invoiceItems: [] });
      };
      const dependencies: Record<string, unknown> = {
        "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "trusted-member", role: "bd_manager", displayName: "Unassigned" }) },
        "@/lib/ai/gateway": {
          generateGatewayText: async (input: Parameters<typeof generate>[0] & { usageUserId?: string }) => {
            assert.equal(input.usageUserId, "trusted-member");
            return generate(input);
          },
        },
        "@/lib/ai/email-reply": reply,
        "@/lib/ai/email-rewrite": rewrite,
        "@/lib/ai/language": { aiLanguageSchema },
        "@/lib/invoice-permissions": invoicePermissions,
        zod: { z },
      };
      const exports = {} as { POST: (request: Request) => Promise<Response> };
      vm.runInNewContext(code, {
        exports,
        require: (name: string) => {
          const dependency = policyTestDependency(name);
          if (dependency) return dependency;
          assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
          return dependencies[name];
        },
        Response, URL, console,
        process: { env: provider === "oidc" ? { VERCEL_OIDC_TOKEN: "test-oidc" } : { AI_GATEWAY_API_KEY: "test", ...(provider === "legacy-budget" ? { AI_BUDGET_ENFORCEMENT: "true" } : {}) } },
      });
      const conversationHistory = [{ direction: "inbound", subject: "Invoice request for ORDER #1297", body: "Please update my billing address and send your catalog." }];
      const customerProfile = { summary: "意大利客户，需要产品目录。" };
      const response = await exports.POST(new Request("http://localhost/api/email/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, recipient: "david@example.com", companyName: "DASOTEC S.r.l.", customerProfile, conversationHistory, products: [] }),
      }));
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.plan.body, `${body}\n\nBest regards,\n\nFilazoo Sales Team\nBD Sales Manager\nFilazoo`);
      assert.equal(result.plan.attachCatalog, true);
      assert.deepEqual(result.plan.invoiceItems, []);
      assert.equal(calls.length, 1);
      assert.match(calls[0].systemInstruction, /Always write the entire finished email in professional English/);
      assert.doesNotMatch(calls[0].systemInstruction, /professional Simplified Chinese/);
      const prompt = JSON.parse(calls[0].prompt);
      assert.equal(prompt.language, "en");
      assert.deepEqual(prompt.conversationHistory, conversationHistory);
      assert.deepEqual(prompt.customerProfile, customerProfile);
    });
  }
}
