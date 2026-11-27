import assert from "node:assert/strict";
import test from "node:test";
import { sameEmailPage, emailPageRequestSchema, type EmailPageSnapshot } from "../lib/email-pagination.ts";

const page = (): EmailPageSnapshot => ({ emails: [{ id: "one", subject: "Question", contact: "buyer@test", direction: "inbound", status: "Received", company: "Buyer", body: "", preview: "Hello", timestamp: "2026-11-27T00:00:00Z", bodyLoaded: false }],
  pagination: { request: emailPageRequestSchema.parse({}), revision: "old", pageSize: 30, total: 50, folderCounts: { inbox: 50, sent: 10 }, followupCounts: { all: 0, ai: 0, manual: 0, completed: 0, nurture: 0 } } });

test("an unrelated revision or loaded body does not evict visited pages", () => {
  const current = page(), next = page();
  next.pagination.revision = "new";
  next.pagination.folderCounts = { sent: 10, inbox: 50 };
  current.emails[0] = { ...current.emails[0], bodyLoaded: true, body: "Opened message content", html: "<p>Opened</p>" };
  assert.equal(sameEmailPage(current, next), true);
});

test("new messages, flags, ordering, tags and totals invalidate stale pages", () => {
  for (const change of [
    (next: EmailPageSnapshot) => { next.emails[0].id = "new"; },
    (next: EmailPageSnapshot) => { next.emails[0].read = true; },
    (next: EmailPageSnapshot) => { next.emails[0].starred = true; },
    (next: EmailPageSnapshot) => { next.emails[0].category = "New Inquiries"; },
    (next: EmailPageSnapshot) => { next.pagination.total++; },
    (next: EmailPageSnapshot) => { next.pagination.folderCounts.inbox++; },
  ]) { const next = page(); change(next); assert.equal(sameEmailPage(page(), next), false); }
});
