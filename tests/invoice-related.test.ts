import test from "node:test";
import assert from "node:assert/strict";
import { relatedInvoiceOrder, literalInvoiceEmail } from "../lib/invoice-related.ts";
import { blankInvoiceDocument, type Invoice } from "../lib/invoices.ts";

function invoice(id: string, created: string, thread?: string): Invoice {
  return { id, number: 1, status: "draft", total_minor: 100, paid_minor: 0, revision: 1,
    created_at: created, updated_at: created, source_thread_id: thread,
    document: blankInvoiceDocument("2026-10-23") };
}
test("conversation invoices come first; duplicate customer matches appear only once", () => {
  const conversation = invoice("thread", "2026-10-01", "mailbox:thread");
  const recent = invoice("recent", "2026-10-23");
  const older = invoice("older", "2026-10-02");
  const group = [recent, conversation, older];
  const result = relatedInvoiceOrder([[conversation], group], "mailbox:thread");
  assert.deepEqual(result.map((item) => item.id), ["thread", "recent", "older"]);
  assert.deepEqual(group.map((item) => item.id), ["recent", "thread", "older"]);
});
test("legacy document conversation links are recognized and empty results remain empty", () => {
  const legacy = invoice("legacy", "2026-10-01");
  legacy.document.sourceThreadId = "shopify:form:lead";
  assert.equal(relatedInvoiceOrder([[invoice("new", "2026-10-23"), legacy]], "shopify:form:lead")[0].id, "legacy");
  assert.deepEqual(relatedInvoiceOrder([]), []);
});
test("email lookup treats wildcard characters literally and normalizes case", () => {
  assert.equal(literalInvoiceEmail(" Test_User%tag@Example.com "), "test\\_user\\%tag@example.com");
  assert.equal(literalInvoiceEmail("a+b@example.com"), "a+b@example.com");
});
test("recent invoice results are bounded without dropping the current conversation", () => {
  const recent = Array.from({ length: 60 }, (_, index) => invoice(String(index), "2026-10-23"));
  const match = invoice("conversation", "2026-01-01", "thread");
  const result = relatedInvoiceOrder([recent, [match]], "thread");
  assert.equal(result.length, 50);
  assert.equal(result[0].id, match.id);
});
