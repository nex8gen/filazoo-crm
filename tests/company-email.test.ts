import assert from "node:assert/strict";
import test from "node:test";
import { filterCompanyEmails } from "../lib/company-email.ts";

const company = { id: "customer-a", name: "Customer A", emails: [" Buyer@customer.test ", "accounts@customer.test", ""] };

test("company email includes incoming and sent messages for every saved contact", () => {
  const messages = [
    { id: "received", contact: "buyer@customer.test", direction: "inbound" },
    { id: "sent", contact: "ACCOUNTS@customer.test", direction: "outbound" },
    { id: "other", contact: "other@customer.test", direction: "inbound" },
  ];
  assert.deepEqual(filterCompanyEmails(messages, company).map((message) => message.id), ["received", "sent"]);
});

test("company names, guessed IDs, shared domains, and blank addresses cannot include other customers", () => {
  const messages = [
    { contact: "stranger@elsewhere.test", company: company.name, companyId: company.id },
    { contact: "other@customer.test", company: company.name, companyId: company.id },
    { contact: "", company: company.name, companyId: company.id },
  ];
  assert.deepEqual(filterCompanyEmails(messages, company), []);
  assert.deepEqual(filterCompanyEmails([{ contact: "buyer@customer.test" }], { ...company, emails: [] }), []);
});

test("each refreshed snapshot remains scoped to the selected company", () => {
  const snapshot = [
    { id: "a", contact: "buyer@customer.test" },
    { id: "b", contact: "buyer@other.test" },
    { id: "a-new", contact: "accounts@customer.test" },
  ];
  assert.deepEqual(filterCompanyEmails(snapshot, company).map((message) => message.id), ["a", "a-new"]);
  assert.deepEqual(filterCompanyEmails(snapshot, { id: "b", name: "Other", emails: ["buyer@other.test"] }).map((message) => message.id), ["b"]);
});
