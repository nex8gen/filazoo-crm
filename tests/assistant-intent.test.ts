import assert from "node:assert/strict";
import test from "node:test";
import { isInvoiceCreationRequest } from "../lib/ai/assistant-intent.ts";

test("recognizes direct invoice work including the reported request and ordinary spelling errors", () => {
  for (const text of ["can create a invoice for abe m for pla basic 500 qty", "Can you create an invoice for Abe?", "Please prepare a draft invoice", "I want to create an invioce", "Create an invoice without sending it", "Create an invoice, do not email it", "帮我创建发票"]) assert.equal(isInvoiceCreationRequest(text), true, text);
  for (const text of ["How can I create an invoice?", "Don't create an invoice", "Explain how to create an invoice", "Show an example invoice", "Did you create the invoice?", "Can you summarize this page?", "Create a task to review the invoice", "不要创建发票", "请不要创建发票", "如何创建发票"]) assert.equal(isInvoiceCreationRequest(text), false, text);
});
