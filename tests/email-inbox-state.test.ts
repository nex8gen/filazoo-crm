import assert from "node:assert/strict";
import test from "node:test";
import { emailInboxStateSchema } from "../lib/email-inbox-state.ts";
import { parseEmailSummary } from "../lib/ai/email-summary.ts";

const state = { messageKey: "message-1", category: "Needs follow-up", starred: false, read: true, folder: "inbox" };

test("AI follow-up with a Shanghai offset can be saved as UTC", () => {
  const summary = parseEmailSummary(JSON.stringify({ title: "Buyer question", summary: "Buyer needs pricing.", nextStep: "Send a quote.", followUpAt: "2026-10-26T09:00:00+08:00", followUpReason: "Respond next business day." }));
  const saved = emailInboxStateSchema.parse({ ...state, followUpAt: summary.followUpAt });
  assert.equal(saved.followUpAt, "2026-10-26T01:00:00.000Z");
  assert.equal(Date.parse(saved.followUpAt!), Date.parse(summary.followUpAt!));
});

test("state accepts UTC and no follow-up, and rejects ambiguous or invalid dates", () => {
  assert.equal(emailInboxStateSchema.parse({ ...state, followUpAt: null }).followUpAt, null);
  assert.equal(emailInboxStateSchema.parse({ ...state, followUpAt: "2026-10-26T01:00:00Z" }).followUpAt, "2026-10-26T01:00:00.000Z");
  for (const followUpAt of ["tomorrow", "2026-10-26T09:00:00", "2026-02-30T09:00:00+08:00"]) {
    assert.equal(emailInboxStateSchema.safeParse({ ...state, followUpAt }).success, false);
  }
});
