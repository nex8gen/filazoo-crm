import { aiTextEvaluationCases } from "./ai-text-evaluation-cases.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { resolveGatewayTokenAsync } from "../lib/ai/provider-credentials.ts";

// Synthetic records only. This verifier never reads customer mail or sends email.
const cases = aiTextEvaluationCases().filter(scenario => scenario.name.startsWith("ai-followup:"));
if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ live: false, cases: cases.map(scenario => scenario.name) }, null, 2));
} else {
  const token = await resolveGatewayTokenAsync(process.env);
  if (!token) throw new Error("Configure the AI provider before running live follow-up evaluations.");
  let failed = 0;
  for (const scenario of cases) {
    const startedAt = Date.now();
    const input = scenario.text!;
    try {
      const output = await generateGatewayText({ token, task: input.task, systemInstruction: input.instruction, prompt: input.prompt,
        maxOutputTokens: 2400, signal: AbortSignal.timeout(55_000) });
      const passed = input.check(output);
      if (!passed) failed++;
      console.log(JSON.stringify({ case: scenario.name, passed, elapsedMs: Date.now() - startedAt, output }));
    } catch (error) {
      failed++;
      console.log(JSON.stringify({ case: scenario.name, passed: false, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "Evaluation failed" }));
    }
  }
  console.log(JSON.stringify({ cases: cases.length, passed: cases.length - failed, failed }));
  if (failed) process.exitCode = 1;
}
