import assert from "node:assert/strict";
import test from "node:test";
import { filterCompanyEmails, scopeCompanyEmailContent } from "../lib/company-email.ts";

const company = { id: "customer-a", name: "Customer A", emails: [" Buyer@customer.test ", "accounts@customer.test", ""] };

test("company email includes incoming and sent messages for every saved contact", () => {
  const messages = [
    { id: "received", contact: "buyer@customer.test", direction: "inbound" },
    { id: "sent", contact: "ACCOUNTS@customer.test", direction: "outbound" },
    { id: "other", contact: "other@customer.test", direction: "inbound" },
  ];
  assert.deepEqual(filterCompanyEmails(messages, company).map((message) => message.id), ["received", "sent"]);
});

test("secondary recipients and staff-to-staff copies match exact customer headers without matching quoted bodies", () => {
  const messages = [
    { id: "secondary-to", contact: "other@elsewhere.test", to: [{ address: "other@elsewhere.test" }, { address: "BUYER@customer.test" }] },
    { id: "cc", contact: "staff@seller.test", from: "staff@seller.test", cc: [{ address: "accounts@customer.test" }] },
    { id: "bcc", contact: "other@elsewhere.test", bcc: [{ address: "buyer@customer.test" }] },
    { id: "sender", contact: "staff@seller.test", from: "buyer@customer.test" },
    { id: "quoted", contact: "private@elsewhere.test", body: "Forwarded to buyer@customer.test", to: [{ address: "not-buyer@customer.test" }] },
  ];
  assert.deepEqual(filterCompanyEmails(messages, company).map(message => message.id), ["secondary-to", "cc", "bcc", "sender"]);
});

test("company authorization survives inline sent files, escaped URLs and repeated scoping", () => {
  for (const url of ["/api/email/attachments/id/0", "/api/email/received-attachment?mailbox=key&uid=42&part=2"]) {
    const scoped = scopeCompanyEmailContent({ html: `<img src="${url.replaceAll("&", "&amp;")}">`, attachments: [{ url }] }, "company");
    assert.equal(new URL(scoped.attachments![0].url!, "http://crm.local").searchParams.get("companyId"), "company");
    assert.equal(scoped.html!.match(/companyId=company/g)?.length, 1);
    assert.equal(scopeCompanyEmailContent(scoped, "company").html, scoped.html);
  }
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
