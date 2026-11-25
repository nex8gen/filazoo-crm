// Synthetic model qualification only. No real customers are read and no business
// action is stored, executed or sent. Opt in with --live and configured Gateway auth.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { generateCrmPlan, nativeGatewayModels } from "../lib/ai/native-agent.ts";
import { createBudgetedAiFetch } from "../lib/ai/budget-fetch.ts";

const readyId = "15693adc-0bdf-4617-b214-71b1861764a9";
const rejectedId = "25693adc-0bdf-4617-b214-71b1861764a9";
const pitchId = "35693adc-0bdf-4617-b214-71b1861764a9";
const email = (id: string, direction: string, body: string, date: string) => ({ id, href: `/email?thread=${id}`, subject: "Black PLA inquiry", direction, timestamp: date, contentAvailable: true, body: { text: body, truncated: false } });
const records = [
  { id: rejectedId, name: "Synthetic Declined", href: `/companies/${rejectedId}`, profile: { fitScore: 10 }, email: { messages: 2, conversations: 1, complete: true, records: [email("declined-latest", "inbound", "We have selected another supplier. Do not contact us again.", "2026-11-24T10:00:00Z"), email("declined-old", "inbound", "We may want 500 rolls.", "2026-10-01T10:00:00Z")] } },
  { id: readyId, name: "Synthetic Ready", href: `/companies/${readyId}`, profile: { fitScore: 6 }, email: { messages: 2, conversations: 1, complete: true, records: [email("ready-latest", "inbound", "We approve the black PLA sample and quoted price for 500 rolls. Please send the order details and invoice for our review today.", "2026-11-25T02:00:00Z"), email("ready-offer", "outbound", "Here is the quotation you requested.", "2026-11-24T10:00:00Z")] } },
  { id: pitchId, name: "Synthetic Unresponsive", href: `/companies/${pitchId}`, profile: { fitScore: 9 }, email: { messages: 1, conversations: 1, complete: true, records: [email("pitch-only", "outbound", "Our filament would be perfect for you. Would you like to order 2000 rolls?", "2026-11-25T03:00:00Z")] } },
];
const cases = ["evidence-ranking", "segment-from-analysis"];
if (!process.argv.includes("--live")) { console.log(JSON.stringify({ cases, syntheticOnly: true, businessWrites: false, maximumCallsPerCase: 6 })); process.exit(0); }
const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
if (!token) throw new Error("Configured Gateway credentials are required for live synthetic verification.");
const catalogResponse = await fetch("https://ai-gateway.vercel.sh/v1/models");
if (!catalogResponse.ok) throw new Error("Unable to verify current Gateway model prices.");
const catalog = await catalogResponse.json() as { data: Array<{ id: string; pricing?: { input: string; output: string; input_cache_write?: string }; context_window?: number }> };
let chargedMicros = 0;
const results: Array<Record<string, unknown>> = [];
for (const name of cases) {
  let providerCalls = 0;
  const reads: string[] = [];
  const transport: typeof fetch = (url, init) => {
    if (++providerCalls > 6) throw new Error("Synthetic provider call limit reached.");
    return fetch(url, init);
  };
  const fetcher = createBudgetedAiFetch(readyId, {
    reserve: async (_user, _model, micros) => { if (chargedMicros + micros > 100_000) throw new Error("Synthetic verification reached its $0.10 cost bound."); return { allowed: true, reservationId: "synthetic" }; },
    settle: async (_user, _reservation, micros) => { chargedMicros += micros; },
  }, async model => {
    const entry = catalog.data.find(entry => entry.id === model), pricing = entry?.pricing;
    if (!pricing) throw new Error("Model pricing is absent from the current Gateway catalog.");
    return { input: Math.max(Number(pricing.input), Number(pricing.input_cache_write ?? pricing.input)), output: Number(pricing.output), context: entry?.context_window ?? 1_000_000, webSearch: 0 };
  }, transport);
  const text = name === "evidence-ranking"
    ? "Analyze all saved customers and rank who is most likely to order, with dated email proof, conversation counts and a specific next step for each. Begin your answer with the exact name of the single best customer. Respect opt-outs; do not create records or send anything."
    : "Create a segment called Ready buyers with exactly the customer recommended in the previous analysis. Do not include the declined or unresponsive customers. Do not send anything.";
  const messages = name === "evidence-ranking" ? [{ role: "user", content: text }] : [
    { role: "user", content: "Analyze the customers most likely to order." },
    { role: "assistant", content: `Recommend [Synthetic Ready](/companies/${readyId}) only: explicit sample/price approval on November 25. Synthetic Declined opted out and Synthetic Unresponsive has no inbound buying signal.` },
    { role: "user", content: text },
  ];
  const start = performance.now();
  try {
    const models = await nativeGatewayModels({ token, userId: readyId, userText: text, fetcher });
    const plan = await generateCrmPlan({ ...models, prompt: JSON.stringify({ CONVERSATION: messages }), messages, pathname: "/companies", language: "en", signal: AbortSignal.timeout(60_000),
      read: async input => { reads.push(input.resource); return { records: input.companyId || input.id ? records.filter(row => row.id === (input.companyId || input.id)) : records, coverage: { matching: records.length, included: records.length, nextOffset: null, scope: "Complete synthetic dataset" } }; },
      searchEmails: async () => ({ messages: records.flatMap(row => row.email.records), coverage: { nextOffset: null } }),
      validateAction: action => { assert.equal(name, "segment-from-analysis"); assert.equal(action.type, "crm_action"); if (action.type !== "crm_action" || action.operation.op !== "create_segment") throw new Error("Only the requested segment may be proposed."); assert.deepEqual(action.operation.segment.rules.companyIds, [readyId]); },
    });
    if (name === "evidence-ranking") {
      assert.equal(plan.actions.length, 0); assert.ok(reads.includes("customer_insights"));
      assert.match(plan.output.slice(0, 140), /Synthetic Ready/);
      assert.match(plan.output, /ready-latest|2026-11-25|Nov(?:ember)?\.?\s*25|25\s*Nov/i);
      assert.match(plan.output, /opt.out|do not contact|declin|another supplier/i);
    } else assert.equal(plan.actions.length, 1);
    results.push({ name, passed: true, providerCalls, elapsedMs: Math.round(performance.now() - start), reads, output: plan.output, actions: plan.actions });
  } catch (error) { results.push({ name, passed: false, providerCalls, elapsedMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : "Verification failed" }); }
  console.log(JSON.stringify({ name, passed: results.at(-1)!.passed, providerCalls, elapsedMs: results.at(-1)!.elapsedMs }));
}
mkdirSync("docs/audit-evidence", { recursive: true });
writeFileSync("docs/audit-evidence/customer-intelligence-20261125.json", JSON.stringify({ syntheticOnly: true, businessWrites: false, chargedUsd: chargedMicros / 1_000_000, results }, null, 2) + "\n");
if (results.some(result => !result.passed)) process.exitCode = 1;
