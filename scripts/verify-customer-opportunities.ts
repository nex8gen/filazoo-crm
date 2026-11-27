// Synthetic qualification only: no customer records, business writes or email sends.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { findCustomerOpportunities } from "../lib/ai/customer-opportunities.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { resolveGatewayTokenAsync } from "../lib/ai/provider-credentials.ts";
import { splitFollowUpQuestions } from "../lib/ai/follow-up-questions.ts";

if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ syntheticOnly: true, businessWrites: false, customers: 331, maximumProviderCalls: 8, cases: ["last-page buyer", "form-only volume", "why/conversation/next step", "clickable questions"] }));
  process.exit(0);
}
const token = await resolveGatewayTokenAsync();
if (!token) throw new Error("Configured Vercel AI Gateway credentials are required.");
const ids = Array.from({ length: 331 }, (_, index) => `15693adc-0bdf-4617-b214-${String(index).padStart(12, "0")}`);
const winner = ids.at(-1)!;
const buyerText = "The samples passed our tests. We want to order 500 rolls of black PLA for delivery next month. Please confirm the final quotation and available dispatch date.";
const formText = "Materials: PLA and PETG, basic colors. Estimated monthly volume: 50–199 kg";
const source = (id: string, direction: string, body: string, timestamp: string) => ({ id, direction, timestamp, href: `/email?thread=${id}`, subject: "Re: Re: Re: Filament enquiry", body: { text: body, truncated: false }, contentAvailable: true });
const records = ids.map((id, index) => ({ id, name: id === winner ? "Synthetic Sample Buyer" : `Synthetic Customer ${index}`, country: "US", href: `/companies/${id}`,
  assignedTo: { userId: ids[0], name: "Casey" }, purchasePipeline: { activeOrders: 0, complete: true, available: true }, notes: { records: [], count: 0, complete: true },
  email: { messages: id === winner ? 2 : index === 25 ? 1 : 0, available: true, countsComplete: true, complete: true, replyState: id === winner ? "awaiting_team" : "no_messages",
    records: id === winner ? [source(`buyer-${id}`, "inbound", buyerText, "2026-11-26T10:00:00Z"), source(`team-${id}`, "outbound", "We sent the requested samples. Please let us know the test results.", "2026-11-20T10:00:00Z")]
      : index === 25 ? [source(`form-${id}`, "inbound", formText, "2026-11-26T10:00:00Z")] : [] },
}));
let calls = 0, inputTokens = 0, outputTokens = 0;
const models = new Set<string>();
const transport: typeof fetch = async (url, init) => { if (++calls > 8) throw new Error("Synthetic provider-call limit reached."); return fetch(url, init); };
const started = performance.now();
const result = await findCustomerOpportunities({ question: "Can you find our best customers most likely to order? Include why each is promising, a short conversation summary, and what we should do next.", language: "en", now: "2026-11-27T04:00:00Z", signal: AbortSignal.timeout(110_000),
  readPopulation: async input => ({ records: records.slice(input.offset, input.offset + 200), coverage: { matching: records.length, nextOffset: input.offset === 0 ? 200 : null } }),
  read: async input => ({ records: records.filter(row => row.id === input.companyId), coverage: { nextOffset: null } }),
  searchEmails: async input => ({ messages: records.find(row => row.id === input.companyId)!.email.records.map(message => ({ ...message, companyId: input.companyId, text: message.body.text })), coverage: { nextOffset: null } }),
  generate: input => generateGatewayText({ token, fetcher: transport, task: "chat", complex: true, signal: AbortSignal.timeout(45_000), systemInstruction: input.systemInstruction, prompt: input.prompt,
    responseJsonSchema: input.responseJsonSchema, strictSchema: true, maxOutputTokens: input.maxOutputTokens,
    onGeneration: async generation => { models.add(generation.model); inputTokens += generation.inputTokens ?? 0; outputTokens += generation.outputTokens ?? 0; },
  }),
});
assert.equal(result.coverage.populationComplete, true);
assert.equal(result.coverage.included, 331);
assert.equal(result.coverage.modelScreenedCustomers, 331);
assert.deepEqual(result.recommendations.map(row => row.companyId), [winner]);
assert.match(result.output, /\*\*Why:\*\*/);
assert.match(result.output, /\*\*Conversation:\*\*/);
assert.match(result.output, /\*\*Next step:\*\*/);
assert.match(result.output, /500/);
assert.ok(splitFollowUpQuestions(result.output).questions.length > 0);
assert.doesNotMatch(result.output, /Re: Re:/);
assert.doesNotMatch(result.output, /Synthetic Customer 25/);
assert.equal(result.coverage.incompleteConversations, 0, "Discarding form metadata is not missing conversation history");
const receipt = { checkedAt: new Date().toISOString(), syntheticOnly: true, businessWrites: false, models: [...models], providerCalls: calls, inputTokens, outputTokens,
  elapsedMs: Math.round(performance.now() - started), coverage: result.coverage, output: result.output, passed: true };
mkdirSync("docs/audit-evidence", { recursive: true });
writeFileSync("docs/audit-evidence/customer-opportunity-quality-20261127.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ passed: true, customersScreened: 331, recommendedBuyers: result.recommendations.length, providerCalls: calls, inputTokens, outputTokens, elapsedMs: receipt.elapsedMs }));
