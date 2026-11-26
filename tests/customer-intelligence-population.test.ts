import test from "node:test";
import assert from "node:assert/strict";
import { collectCustomerComparison, customerScreeningRecord } from "../lib/ai/customer-intelligence-population.ts";
import { isCustomerRankingRequest } from "../lib/ai/customer-intelligence.ts";

const customer = (index: number) => ({
  id: `customer-${index}`, href: `/companies/customer-${index}`, name: `Customer ${index}`, country: "US",
  email: { messages: 2, conversations: 1, inbound: 1, outbound: 1, available: true, countsComplete: true,
    records: [
      { id: `in-${index}`, href: `/email?thread=${index}`, direction: "inbound", timestamp: "2026-11-25T10:00:00Z", subject: "Order enquiry", body: { text: index === 325 ? "Please confirm delivery for 500 rolls next week." : "Please send details.", truncated: false }, contentAvailable: true },
      { id: `out-${index}`, href: `/email?thread=${index}`, direction: "outbound", timestamp: "2026-11-26T10:00:00Z", subject: "Re: Order enquiry", body: { text: "Which color do you need?", truncated: false }, contentAvailable: true },
    ] },
  profile: { fitScore: 10, summary: "Profile alone is not intent" },
  notes: { count: 0, records: [], available: true, complete: true },
});

test("screening reaches the last of 326 customers without a model round per page", async () => {
  const offsets: number[] = [];
  const all = Array.from({ length: 326 }, (_, index) => customer(index));
  const result = await collectCustomerComparison(async lookup => {
    offsets.push(lookup.offset);
    assert.equal(lookup.resource, "customer_insights"); assert.equal(lookup.query, "");
    return { records: all.slice(lookup.offset, lookup.offset + 20), coverage: { matching: all.length, nextOffset: lookup.offset + 20 < all.length ? lookup.offset + 20 : null } };
  });
  assert.equal(offsets.length, 17); assert.equal(offsets.at(-1), 320);
  assert.equal(result.coverage.populationComplete, true); assert.equal(result.coverage.included, 326);
  assert.equal(result.coverage.nextOffset, null); assert.equal(result.coverage.deepReviewRequired, true);
  assert.match(result.records.at(-1)!.email.records[1].body.text, /500 rolls next week/);
  assert.equal(result.records.at(-1)!.email.complete, false);
  assert.doesNotMatch(JSON.stringify(result), /fitScore|Profile alone/);
});

test("screening bounds preserve continuation at the first omitted customer", async () => {
  const firstSize = JSON.stringify(customerScreeningRecord(customer(0))).length;
  const result = await collectCustomerComparison(async () => ({ records: [customer(0), customer(1), customer(2)], coverage: { matching: 3, nextOffset: null } }), { maxCharacters: firstSize + 1 });
  assert.equal(result.records.length, 1); assert.equal(result.coverage.nextOffset, 1);
  assert.equal(result.coverage.populationComplete, false); assert.match(result.coverage.incompleteReason!, /evidence limit/);
});

test("unavailable history stays unknown and truncated excerpts cannot imply full conversation review", () => {
  const row = customer(0);
  row.email.countsComplete = false; row.email.available = false;
  row.email.records[0].body.text = "x".repeat(1200);
  const result = customerScreeningRecord(row);
  assert.equal(result.email.available, false); assert.equal(result.email.countsComplete, false);
  const inbound = result.email.records.find(message => message.direction === "inbound")!;
  assert.equal(inbound.body.text.length, 500); assert.equal(inbound.body.truncated, true);
});

test("failed or non-advancing population pages remain explicitly incomplete without leaking errors", async () => {
  for (const fail of [true, false]) {
    let calls = 0;
    const result = await collectCustomerComparison(async () => {
      if (fail && ++calls > 1) throw new Error("PRIVATE FAILURE");
      return { records: [customer(0)], coverage: { matching: 2, nextOffset: fail ? 1 : 0 } };
    });
    assert.equal(result.coverage.populationComplete, false);
    assert.equal(result.records.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE FAILURE/);
  }
});

test("population screening respects cancellation and page bounds", async () => {
  const signal = AbortSignal.abort();
  const cancelled = await collectCustomerComparison(async () => assert.fail("must not start reads after cancellation"), { signal });
  assert.equal(cancelled.coverage.populationComplete, false);
  assert.equal(cancelled.coverage.nextOffset, 0);
  const limited = await collectCustomerComparison(async () => ({ records: [customer(0)], coverage: { matching: 3, nextOffset: 1 } }), { maxPages: 1 });
  assert.equal(limited.coverage.populationComplete, false); assert.equal(limited.coverage.nextOffset, 1);
});

test("broad rankings trigger screening while named account work and ordinary drafts keep their scope", () => {
  for (const question of ["can you find top costomers who are most problaiy can order", "Who are the customers likely to order?", "Rank prospects by buying intent", "哪些客户最有可能下单"]) assert.equal(isCustomerRankingRequest(question), true, question);
  for (const question of ["Draft a thank you email", "Analyze Acme's order history", "Find the top products", "Create an invoice for this customer"]) assert.equal(isCustomerRankingRequest(question), false, question);
});
