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
  assert.match(result.output, /^\*\*1\. \[Undiscovered buyer\]/);
  assert.doesNotMatch(result.output, /Account manager:|Already in order preparation|Blockers:|Evidence confidence:|These are opportunities|Screening used/);
  assert.match(result.output, /\*\*Why:\*\*/);
  assert.match(result.output, /\*\*Conversation:\*\* The customer approved samples/);
  assert.match(result.output, /\*\*Next step:\*\* Enphany — Confirm colors/);
  assert.match(result.output, /Coverage: screened 3 of 3 customers; reviewed conversations for 1/);
  assert.equal(result.recommendations[0].nextAction, decision().nextAction, "Full analysis remains available for follow-up actions");
  assert.equal(result.coverage.knownPipelineCustomers, 1);
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

test("form volumes and material preferences alone do not qualify a recommended buyer", () => {
  const form = { ...account(), sources: [{ ...account().sources[0], body: "Materials: PLA and PETG, basic colors. Estimated monthly volume: 50–199 kg" }] };
  for (const quote of ["Estimated monthly volume: 50–199 kg", "PLA and PETG, basic colors"]) {
    assert.equal(validateOpportunityDecision({ ...decision(), outcome: "evaluating", evidence: [{ sourceId: form.sources[0].id, quote }] }, form), null);
  }
  const reply = { ...account(), sources: [{ ...account().sources[0], body: "Precisamos de uma cotação para 500 rolos. Estimated monthly volume: 50–199 kg" }] };
  assert.ok(validateOpportunityDecision({ ...decision(), outcome: "evaluating", evidence: [{ sourceId: reply.sources[0].id, quote: "Precisamos de uma cotação para 500 rolos." }] }, reply));
});

test("discarded form-only leads do not appear in follow-up questions or create a false missing-history warning", async () => {
  const form = company(declined);
  form.name = "Ciale";
  form.email.records = [mail(`email-${declined}`, "inbound", "PLA and PETG. Estimated monthly volume: 50–199 kg")];
  const records = [company(ready), form];
  const result = await findCustomerOpportunities({ question: "Find our best customers", language: "en", now: "2026-11-27T04:00:00Z",
    read: async input => ({ records: input.companyId ? records.filter(row => row.id === input.companyId) : records, coverage: { matching: 2, nextOffset: null } }),
    searchEmails: async () => ({ messages: [], coverage: { nextOffset: null } }),
    generate: async input => input.phase === "screen" ? JSON.stringify({ companyIds: [ready, declined] }) : JSON.stringify({
      decisions: [decision(), { ...decision(declined), outcome: "evaluating", evidence: [{ sourceId: `email-${declined}`, quote: "Estimated monthly volume: 50–199 kg" }] }],
      presentation: { detail: "concise", followUpQuestions: ["What should Enphany ask the undiscovered buyer next?", "Has Ciale replied with their material preferences?"] },
    }),
  });
  assert.deepEqual(result.recommendations.map(row => row.companyId), [ready]);
  assert.match(result.output, /What should Enphany ask the undiscovered buyer next/);
  assert.doesNotMatch(result.output, /Ciale|Provisional|history is incomplete/);
  assert.equal(result.coverage.rejectedEvidence, 1);
  assert.equal(result.coverage.incompleteConversations, 0);
});

test("all 331 customers are screened in bounded model batches, including the strongest buyer on the last page", async () => {
  const ids = Array.from({ length: 331 }, (_, index) => `15693adc-0bdf-4617-b214-${String(index).padStart(12, "0")}`);
  const winner = ids.at(-1)!;
  const records = ids.map(id => {
    const row = company(id);
    row.name = id === winner ? "Last-page buyer" : `Buyer ${id}`;
    row.email.records = Array.from({ length: 4 }, (_, index) => mail(index ? `other-${index}-${id}` : `email-${id}`, index > 1 ? "outbound" : "inbound", "We want 500 rolls delivered next month. " + "Conversation context. ".repeat(30)));
    return row;
  });
  const screened: string[] = [], offsets: number[] = [];
  let comparisons = 0;
  const result = await findCustomerOpportunities({ question: "Find our best customers to follow up", language: "en", now: "2026-11-27T04:00:00Z",
    readPopulation: async input => {
      offsets.push(input.offset);
      return { records: records.slice(input.offset, input.offset + 200), coverage: { matching: 331, nextOffset: input.offset === 0 ? 200 : null } };
    },
    read: async input => { assert.equal(input.companyId, winner); return { records: [records.at(-1)!], coverage: { nextOffset: null } }; },
    searchEmails: async () => ({ messages: [], coverage: { nextOffset: null } }),
    generate: async input => {
      const prompt = JSON.parse(input.prompt);
      if (input.phase === "screen") {
        const candidates = prompt.candidates as { id: string }[];
        if (prompt.task.startsWith("Compare the strongest")) {
          comparisons++; assert.ok(candidates.some(row => row.id === winner));
          return JSON.stringify({ companyIds: [winner] });
        }
        assert.ok(candidates.length <= 80);
        assert.ok(input.prompt.length < 125_000);
        screened.push(...candidates.map(row => row.id));
        return JSON.stringify({ companyIds: [candidates.at(-1)!.id, ...candidates.slice(0, 2).map(row => row.id), "invented-id"] });
      }
      return JSON.stringify({ decisions: [{ ...decision(winner), buyingReason: "Confirmed quantity and a delivery window after sample testing." }] });
    },
  });
  assert.deepEqual(offsets, [0, 200]);
  assert.deepEqual(new Set(screened), new Set(ids));
  assert.equal(screened.length, 331);
  assert.equal(comparisons, 1);
  assert.equal(result.coverage.populationComplete, true);
  assert.equal(result.coverage.modelScreenedCustomers, 331);
  assert.equal(result.coverage.included, 331);
  assert.match(result.output, /Last-page buyer/);
  assert.match(result.output, /\*\*Why:\*\* Confirmed quantity/);
  assert.match(result.output, /\*\*Conversation:\*\*/);
  assert.match(result.output, /\*\*Next step:\*\*/);
  assert.deepEqual(result.recommendations.map(row => row.companyId), [winner]);
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
  assert.equal(failed.recommendations.length, 0); assert.match(failed.output, /Provisional/); assert.doesNotMatch(failed.output, /PRIVATE DB FAILURE|PO-SECRET/);
});

async function presentedAnswer(presentation: { detail: "concise" | "detailed"; followUpQuestions: string[] }, language: "en" | "zh-CN" = "en", qualifies = true) {
  const records = [company(known, 1), company(ready)];
  return findCustomerOpportunities({ question: presentation.detail === "detailed" ? "Give a detailed report on customers likely to order" : "Which customers are most likely to order?", language, now: "2026-11-27T04:00:00Z",
    read: async input => ({ records: input.companyId ? records.filter(row => row.id === input.companyId) : records, coverage: { matching: 2, nextOffset: null } }),
    searchEmails: async () => ({ messages: [], coverage: { nextOffset: null } }),
    generate: async input => {
      assert.match(input.systemInstruction, /Answer the latest question directly/);
      if (input.phase === "screen") return JSON.stringify({ companyIds: [ready] });
      assert.match(input.prompt, /concise by default/);
      assert.match(input.prompt, /only the answer, no suggestions/);
      return JSON.stringify({ decisions: [{ ...decision(), outcome: qualifies ? "purchase_intent" : "declined" }], presentation });
    },
  });
}

test("concise rankings start with the buyer, retain cited proof and end with optional related questions", async () => {
  const result = await presentedAnswer({ detail: "concise", followUpQuestions: ["What is blocking this order?", "What should Enphany ask next?"] });
  assert.match(result.output, /^\*\*1\. \[Undiscovered buyer\]/);
  assert.ok(result.output.indexOf("/email?thread=") < result.output.indexOf("Coverage:"));
  assert.match(result.output, /Related questions: What is blocking this order\? · What should Enphany ask next\?$/);
  assert.doesNotMatch(result.output, /Blockers:|Account manager:/);
  assert.match(result.output, /The customer approved samples/);
  assert.match(result.output, /\*\*Next step:\*\*/);
  assert.equal(result.recommendations[0].confidence, "high");
});

test("detailed requests preserve summaries, managers, blockers and next actions", async () => {
  const result = await presentedAnswer({ detail: "detailed", followUpQuestions: [] });
  assert.match(result.output, /The customer approved samples/);
  assert.match(result.output, /Account manager: Enphany/);
  assert.match(result.output, /Blockers: Confirm available colors/);
  assert.match(result.output, /Next action: Confirm colors/);
  assert.match(result.output, /Evidence confidence: high/);
  assert.match(result.output, /Already in order preparation \(1/);
  assert.doesNotMatch(result.output, /Related questions:/);
});

test("related questions are omitted for answer-only presentation and unsupported recommendations", async () => {
  const answerOnly = await presentedAnswer({ detail: "concise", followUpQuestions: [] });
  assert.doesNotMatch(answerOnly.output, /Related questions:/);
  const noBuyer = await presentedAnswer({ detail: "concise", followUpQuestions: ["What should we ask this customer next?"] }, "en", false);
  assert.match(noBuyer.output, /^The reviewed conversations do not provide enough verified evidence/);
  assert.doesNotMatch(noBuyer.output, /Related questions:|\*\*1\./);
});

test("Chinese rankings use localized coverage and related-question labels", async () => {
  const result = await presentedAnswer({ detail: "concise", followUpQuestions: ["这笔订单还有什么阻碍？"] }, "zh-CN");
  assert.match(result.output, /明确购买意向/);
  assert.match(result.output, /范围：已筛选 2\/2 位客户/);
  assert.match(result.output, /相关问题：这笔订单还有什么阻碍？$/);
  assert.doesNotMatch(result.output, /Related questions:|Coverage:/);
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
