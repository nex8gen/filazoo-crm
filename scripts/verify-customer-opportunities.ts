// Live model qualification with synthetic customers only. No CRM rows, drafts,
// messages or proposals are written. Provider usage is capped at $0.15.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { findCustomerOpportunities } from "../lib/ai/customer-opportunities.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { createBudgetedAiFetch } from "../lib/ai/budget-fetch.ts";

if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ syntheticOnly: true, cases: ["326-customer-conversation-discovery"], businessWrites: false, maximumProviderCalls: 4, maximumUsd: 0.15 }));
  process.exit(0);
}
const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
if (!token) throw new Error("Configured Gateway credentials are required.");
const id = (index: number) => `15693adc-0bdf-4617-b214-${String(index).padStart(12, "0")}`;
const ready = id(325), known = id(0), rejected = id(1), pitch = id(2), form = id(3), fulfilled = id(4);
const email = (companyId: string, key: string, body: string, direction = "inbound", timestamp = "2026-11-25T10:00:00Z") => ({
  id: key, companyId, direction, timestamp, subject: "Filament samples and supply", href: `/email?thread=${key}`,
  body: { text: body, truncated: false }, contentAvailable: true,
});
const records = Array.from({ length: 326 }, (_, index) => ({ id: id(index), name: `Synthetic buyer ${index}`, country: "US", href: `/companies/${id(index)}`,
  purchasePipeline: { activeOrders: index === 0 ? 1 : 0, available: true, complete: true },
  profile: { fitScore: index === 0 ? 10 : 5 },
  orders: { count: index === 0 ? 1 : 0, records: index === 0 ? [{ reference: "PO-SHOULD-NOT-RANK", totalMinor: 99999999, status: "draft" }] : [] },
  notes: { count: 0, complete: true, available: true, records: [] },
  email: { messages: 0, inbound: 0, outbound: 0, conversations: 0, available: true, complete: true, countsComplete: true, records: [] as ReturnType<typeof email>[] },
}));
const assign = (companyId: string, name: string, messages: ReturnType<typeof email>[]) => {
  const row = records.find(row => row.id === companyId)!;
  row.name = name; row.email.records = messages; row.email.messages = messages.length;
  row.email.inbound = messages.filter(message => message.direction === "inbound").length;
  row.email.outbound = messages.length - row.email.inbound; row.email.conversations = 1;
};
assign(known, "Synthetic Known Draft", [email(known, "known-email", "Please prepare the order for 2000 rolls.")]);
assign(rejected, "Synthetic Newer Rejection", [email(rejected, "rejected-new", "We chose another supplier. Do not contact us again."), email(rejected, "rejected-old", "We want 1000 rolls.", "inbound", "2026-10-01T10:00:00Z")]);
assign(pitch, "Synthetic Outbound Pitch", [email(pitch, "pitch-only", "We prepared a draft for 5000 rolls for you. Are you ready to order?", "outbound")]);
assign(form, "Synthetic Form Only", [email(form, "form-only", "New Shopify B2B form submission. Estimated monthly volume: 2000–4999 kg. Type of business: reseller. No message provided.")]);
assign(fulfilled, "Synthetic Fulfilled", [email(fulfilled, "fulfilled-new", "All goods arrived and this purchase is complete. We do not need further supplies."), email(fulfilled, "fulfilled-old", "Please send the order details for 800 rolls.", "inbound", "2026-10-01T10:00:00Z")]);
assign(ready, "Synthetic Undiscovered Buyer", [email(ready, "ready-new", "The black PLA samples passed our production tests. We want to buy 500 rolls next month. Can you confirm delivery by December 15?"), email(ready, "ready-offer", "Here are the sample specifications you requested.", "outbound", "2026-11-22T10:00:00Z")]);

const response = await fetch("https://ai-gateway.vercel.sh/v1/models");
if (!response.ok) throw new Error("Unable to verify live Gateway pricing.");
const catalog = await response.json() as { data: Array<{ id: string; pricing?: { input: string; output: string; input_cache_write?: string }; context_window?: number }> };
let chargedMicros = 0, providerCalls = 0;
const fetcher = createBudgetedAiFetch(ready, {
  reserve: async (_user, _model, micros) => { if (chargedMicros + micros > 150_000) throw new Error("Synthetic verification cost limit reached."); return { allowed: true, reservationId: "synthetic" }; },
  settle: async (_user, _reservation, micros) => { chargedMicros += micros; },
}, async model => {
  const row = catalog.data.find(row => row.id === model);
  if (!row?.pricing) throw new Error("No current price for the configured model.");
  return { input: Math.max(Number(row.pricing.input), Number(row.pricing.input_cache_write ?? row.pricing.input)), output: Number(row.pricing.output), context: row.context_window ?? 1_000_000, webSearch: 0 };
}, async (url, init) => {
  if (++providerCalls > 4) throw new Error("Synthetic provider call limit reached.");
  return fetch(url, init);
});
const offsets: number[] = [], searched: string[] = [];
const start = performance.now();
const result = await findCustomerOpportunities({ question: "can you find top most probably give us order customer", language: "en", now: "2026-11-26T04:00:00Z", signal: AbortSignal.timeout(110_000),
  read: async input => {
    if (input.companyId) return { records: records.filter(row => row.id === input.companyId), coverage: { matching: 1, nextOffset: null } };
    offsets.push(input.offset);
    return { records: records.slice(input.offset, input.offset + 20), coverage: { matching: records.length, nextOffset: input.offset + 20 < records.length ? input.offset + 20 : null } };
  },
  searchEmails: async input => {
    searched.push(input.companyId!);
    const messages = records.find(row => row.id === input.companyId)!.email.records.map(message => ({ ...message, text: message.body.text }));
    return { messages: messages.slice(input.offset, input.offset + 8), coverage: { nextOffset: input.offset + 8 < messages.length ? input.offset + 8 : null } };
  },
  generate: async input => {
    assert.doesNotMatch(input.prompt, /PO-SHOULD-NOT-RANK|99999999|fitScore/);
    return generateGatewayText({ ...input, token: token!, usageUserId: ready, fetcher, task: "chat", complex: true, strictSchema: true });
  },
});
assert.equal(result.coverage.populationComplete, true); assert.equal(offsets.at(-1), 320);
assert.equal(result.recommendations[0]?.companyId, ready);
for (const companyId of [known, rejected, pitch, form, fulfilled]) assert.ok(!result.recommendations.some(row => row.companyId === companyId), companyId);
assert.ok(searched.includes(ready)); assert.match(result.output, /ready-new/);
assert.match(result.output, /Already in order preparation/); assert.doesNotMatch(result.output, /PO-SHOULD-NOT-RANK|99999999/);
const evidence = { passed: true, syntheticOnly: true, businessWrites: false, providerCalls, chargedUsd: chargedMicros / 1_000_000, elapsedMs: Math.round(performance.now() - start), searched, result };
mkdirSync("docs/audit-evidence", { recursive: true });
writeFileSync("docs/audit-evidence/customer-opportunities-20261126.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ passed: true, providerCalls, chargedUsd: evidence.chargedUsd, elapsedMs: evidence.elapsedMs, recommended: result.recommendations.map(row => row.name) }));
