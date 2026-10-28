import assert from "node:assert/strict";
import test from "node:test";
import { canViewEmail } from "../lib/email-access.ts";

test("BD workspace inbox includes only assigned customer addresses across every email source", () => {
  const contacts = new Map([["buyer@example.com", "company-a"], ["accounts@example.com", "company-a"]]);
  const messages = [
    { id: "imap", contact: " BUYER@EXAMPLE.COM " },
    { id: "shopify", contact: "buyer@example.com" },
    { id: "draft", contact: "accounts@example.com" },
    { id: "sent", contact: "other@example.com" },
    { id: "unassigned", contact: "new@example.com" },
    { id: "same-domain", contact: "stranger@example.com" },
    { id: "company-name", contact: "Company A" },
  ];
  assert.deepEqual(messages.filter((message) => canViewEmail({ role: "bd_manager" }, message.contact, contacts)).map((message) => message.id), ["imap", "shopify", "draft"]);
});

test("personal mailbox owners can see every sender without a customer assignment", () => {
  for (const role of ["admin", "operator", "bd_manager", "viewer"] as const) {
    for (const contact of ["new@example.com", "newsletter@example.com", "other-managers-customer@example.com", ""]) {
      assert.equal(canViewEmail({ id: "actor", role }, contact, null, { type: "personal", userId: "actor" }), true);
    }
    assert.equal(canViewEmail({ id: "actor", role }, "buyer@example.com", new Map([["buyer@example.com", "company-a"]]), { type: "personal", userId: "someone-else" }), false);
  }
  assert.equal(canViewEmail({ role: "bd_manager" }, "buyer@example.com", null, { type: "personal", userId: null }), false);
});

test("reassignment removes access from the previous BD manager and gives it to the new owner", () => {
  const email = "buyer@example.com";
  const assigned = new Map([[email, "company-a"]]);
  assert.equal(canViewEmail({ role: "bd_manager" }, email, assigned), true);
  assert.equal(canViewEmail({ role: "bd_manager" }, email, new Map()), false);
  assert.equal(canViewEmail({ role: "bd_manager" }, email, null), false);
});

test("other workspace roles retain their email access", () => {
  for (const role of ["admin", "operator", "viewer"] as const) {
    assert.equal(canViewEmail({ role }, "unassigned@example.com", null), true);
  }
});
