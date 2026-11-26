import test from "node:test";
import assert from "node:assert/strict";
import { conversationCandidate, findCustomerOpportunities, validateOpportunityDecision, type OpportunityGeneration } from "../lib/ai/customer-opportunities.ts";
import { customerOpportunityQuestion, isCustomerOpportunityRequest, isOpportunityAnswerOnly } from "../lib/ai/customer-intelligence.ts";

const ready = "15693adc-0bdf-4617-b214-71b1861764a9", known = "25693adc-0bdf-4617-b214-71b1861764a9", declined = "35693adc-0bdf-4617-b214-71b1861764a9";
const mail = (id: string, direction = "inbound", body = "The samples passed our test. We want 500 rolls delivered next month.", timestamp = "2026-11-25T10:00:00Z") => ({ id, direction, body: { text: body, truncated: false }, timestamp, href: `/email?thread=${id}`, subject: "Sample feedback", contentAvailable: true });
const company = (id: string, activeOrders = 0) => ({ id, name: id === ready ? "Undiscovered buyer" : id === known ? "Known draft buyer" : "Declined buyer", country: "US", href: `/companies/${id}`,
  assignedTo: { userId: "manager", name: "Enphany" },
  email: { messages: 1, inbound: 1, available: true, complete: true, countsComplete: true, records: [mail(`email-${id}`)] },
  purchasePipeline: { activeOrders, complete: true, available: true },
  orders: { count: activeOrders, records: [{ reference: "PO-SECRET", totalMinor: 99999999 }] }, profile: { fitScore: 10 },
  notes: { count: 1, complete: true, records: [{ id: "system-event", type: "order_created", summary: { text: "Draft purchase order PO-SECRET created" } }] },
});
const decision = (id = ready) => ({ companyId: id, latestInboundId: `email-${id}`, outcome: "purchase_intent" as const, confidence: "high" as const,
  evidence: [{ sourceId: `email-${id}`, quote: "We want 500 rolls delivered next month." }], conversationSummary: "The customer approved samples and specified the quantity and delivery window.", blockers: "Confirm available colors.", nextAction: "Confirm colors and the requested delivery date." });

test("the opportunity model receives conversation evidence without order, fit or automatic CRM-event data", () => {
  const projection = conversationCandidate(company(known, 1));
  assert.doesNotMatch(JSON.stringify(projection), /PO-SECRET|99999999|fitScore|order_created|Draft purchase/);
  assert.match(JSON.stringify(projection), /samples passed our test/);
  assert.equal(projection.assignedTo?.name, "Enphany");
});

test("discovery separates known drafts, mandates history reads, and renders verified inbound proof", async () => {
  const records = [company(known, 1), company(ready), company(declined)];
  const calls: string[] = [];
  const result = await findCustomerOpportunities({ question: "can you find top most probably give us order customer", language: "en", now: "2026-11-26T04:00:00Z",
    read: async input => {
      calls.push(input.companyId ? `detail:${input.companyId}` : "population");
      return { records: input.companyId ? records.filter(row => row.id === input.companyId) : records, coverage: { matching: records.length, nextOffset: null } };
    },
    searchEmails: async input => {
      calls.push(`email:${input.companyId}`); assert.equal(input.direction, "all");
      return { messages: [{ ...mail(`email-${ready}`), companyId: ready, text: "The samples passed our test. We want 500 rolls delivered next month." }], coverage: { nextOffset: null } };
    },
    generate: async input => {
      assert.doesNotMatch(input.prompt, /PO-SECRET|99999999|fitScore|order_created/);
      if (input.phase === "screen") {
        assert.doesNotMatch(input.prompt, /Known draft buyer/);
        return JSON.stringify({ companyIds: [ready, known, "invented-id"] });
      }
      assert.deepEqual(calls, ["population", `detail:${ready}`, `email:${ready}`]);
      return JSON.stringify({ decisions: [decision()] });
    },
  });
  assert.deepEqual(result.recommendations.map(row => row.companyId), [ready]);
  assert.match(result.output, /1\. \[Undiscovered buyer\]/);
  assert.match(result.output, /2026-11-25.*Sample feedback/);
  assert.match(result.output, /500 rolls delivered next month/);
  assert.match(result.output, /Account manager: Enphany/);
  assert.match(result.output, /Already in order preparation \(1/);
  assert.equal(result.coverage.pipelineClassificationComplete, true);
  assert.doesNotMatch(result.output, /PO-SECRET|99999999/);
});

const account = () => ({ id: ready, name: "Undiscovered buyer", href: `/companies/${ready}`, country: "US", latestInboundId: `email-${ready}`, historyComplete: true, messages: 1,
  sources: [{ id: `email-${ready}`, kind: "email" as const, direction: "inbound", subject: "Samples", timestamp: "2026-11-25T10:00:00Z", body: "We want 500 rolls delivered next month.", href: "/email?thread=ready", truncated: false, contentAvailable: true }],
});

test("server validation rejects fabricated, outbound, cross-account and unreviewed-latest evidence", () => {
  assert.ok(validateOpportunityDecision(decision(), account()));
  assert.equal(validateOpportunityDecision({ ...decision(), evidence: [{ sourceId: "PO-SECRET", quote: "Prepared order for 500 rolls" }] }, account()), null);
  assert.equal(validateOpportunityDecision({ ...decision(), evidence: [{ sourceId: `email-${ready}`, quote: "We accept your invented quotation" }] }, account()), null);
  assert.equal(validateOpportunityDecision({ ...decision(), companyId: declined }, account()), null);
  assert.equal(validateOpportunityDecision({ ...decision(), latestInboundId: "older-message" }, account()), null);
  assert.equal(validateOpportunityDecision(decision(), { ...account(), sources: [{ ...account().sources[0], direction: "outbound" }] }), null);
  assert.equal(validateOpportunityDecision(decision(), { ...account(), sources: [{ ...account().sources[0], contentAvailable: false }] }), null);
  assert.equal(validateOpportunityDecision({ ...decision(), conversationSummary: "High readiness due to a large draft purchase order" }, account()), null);
});

test("incomplete history and evaluation requests cannot be presented as high-confidence purchase intent", () => {
  assert.equal(validateOpportunityDecision(decision(), { ...account(), historyComplete: false })?.confidence, "medium");
  assert.equal(validateOpportunityDecision({ ...decision(), outcome: "evaluating" }, account())?.confidence, "medium");
  for (const outcome of ["declined", "fulfilled", "no_current_intent", "unknown"] as const) assert.equal(validateOpportunityDecision({ ...decision(), outcome }, account()), null);
});

test("quoted old requests are removed before validating the customer's current words", async () => {
  const row = company(ready);
  row.email.records = [mail(`email-${ready}`, "inbound", "Thanks.\n\nOn Tue, Sales wrote:\n> We want 500 rolls delivered next month.")];
  const result = await findCustomerOpportunities({ question: "Top customers likely to order", language: "en", now: "2026-11-26T04:00:00Z",
    read: async () => ({ records: [row], coverage: { matching: 1, nextOffset: null } }),
    searchEmails: async () => ({ messages: [], coverage: { nextOffset: null } }),
    generate: async input => input.phase === "screen" ? JSON.stringify({ companyIds: [ready] }) : JSON.stringify({ decisions: [decision()] }),
  });
  assert.equal(result.recommendations.length, 0);
  assert.match(result.output, /not provide enough verified evidence/);
});

test("missing bodies are hydrated before assessment; failed reads do not fall back to drafts", async () => {
  const row = company(ready);
  row.email.records[0].contentAvailable = false; row.email.records[0].body.text = ""; row.email.complete = false;
  const phases: OpportunityGeneration["phase"][] = [];
  const result = await findCustomerOpportunities({ question: "Top customers likely to order", language: "en", now: "2026-11-26T04:00:00Z",
    read: async () => ({ records: [row], coverage: { matching: 1, nextOffset: null } }),
    searchEmails: async () => ({ messages: [{ ...mail(`email-${ready}`), companyId: ready, text: "We want 500 rolls delivered next month." }], coverage: { nextOffset: null } }),
    generate: async input => { phases.push(input.phase); if (input.phase === "screen") return JSON.stringify({ companyIds: [ready] }); assert.match(input.prompt, /500 rolls delivered/); return JSON.stringify({ decisions: [decision()] }); },
  });
  assert.deepEqual(phases, ["screen", "assess"]); assert.equal(result.recommendations.length, 1);
  const failed = await findCustomerOpportunities({ question: "Top customers likely to order", language: "en", now: "2026-11-26T04:00:00Z",
    read: async input => { if (input.companyId) throw new Error("PRIVATE DB FAILURE"); return { records: [row], coverage: { matching: 1, nextOffset: null } }; },
    searchEmails: async () => assert.fail("Unavailable customers cannot be searched"),
    generate: async () => JSON.stringify({ companyIds: [ready] }),
  });
  assert.equal(failed.recommendations.length, 0); assert.match(failed.output, /provisional/); assert.doesNotMatch(failed.output, /PRIVATE DB FAILURE|PO-SECRET/);
});

test("intent routing preserves historical leaderboards and explicit compound actions", () => {
  for (const question of ["can you find top most probably give us order customer", "Find promising prospects without draft orders", "Find top customers likely to order and create a segment"]) assert.equal(isCustomerOpportunityRequest(question), true, question);
  assert.equal(isCustomerOpportunityRequest("Find top customers by revenue"), false);
  assert.equal(isOpportunityAnswerOnly("Find promising prospects without draft orders"), true);
  assert.equal(isOpportunityAnswerOnly("Find top customers likely to order and create a segment"), false);
  const history = [{ role: "user", content: "Find the top customers likely to order" }, { role: "assistant", content: "Do not copy this previous draft purchase order conclusion" }];
  const filtered = customerOpportunityQuestion([...history, { role: "user", content: "Only customers without draft orders" }]);
  assert.match(filtered!, /Only customers without draft orders/);
  assert.doesNotMatch(filtered!, /previous draft purchase order conclusion/);
  assert.ok(customerOpportunityQuestion([...history, { role: "user", content: "show me more customers" }]));
  assert.equal(customerOpportunityQuestion([...history, { role: "user", content: "Create a segment from these customers" }]), null);
});
