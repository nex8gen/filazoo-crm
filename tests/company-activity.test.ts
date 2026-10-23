import test from "node:test";
import assert from "node:assert/strict";
import { billingActivity, sentMailActivity, mergeCompanyActivity, type ActivityInvoice, type ActivitySentMail } from "../lib/company-activity.ts";
import { readActivityHistory } from "../lib/data/activity-history.ts";

const invoice: ActivityInvoice = {
  id: "invoice-1", number: 4, status: "issued", total_minor: 333498, paid_minor: 333498,
  created_by: "staff", created_at: "2026-10-23T03:00:00Z",
  document: { currency: "USD", customerName: "Customer", customerEmail: "customer@example.com", issueDate: "2026-10-23", dueDate: "2026-11-23", reference: "PO-123" },
};
const names = new Map([["staff", "Sourav"]]);

test("automated billing actions do not inherit a staff identity", () => {
  const [entry] = billingActivity([{ ...invoice, created_by: null }], [], [], names);
  assert.equal(entry.actor, "System");
  assert.equal(entry.actorId, null);
});

test("billing timeline preserves each partial payment, reference, actor, and recorded time", () => {
  const payments = [
    { id: "p1", invoice_id: invoice.id, amount_minor: 333400, paid_on: "2026-10-22", method: "bank_transfer", reference: "WIRE-1", created_by: "staff", created_at: "2026-10-23T03:12:00Z" },
    { id: "p2", invoice_id: invoice.id, amount_minor: 98, paid_on: "2026-10-23", method: "cash", reference: "", created_by: "staff", created_at: "2026-10-23T03:13:00Z" },
  ];
  const activity = billingActivity([invoice], payments, [
    { id: 1, invoice_id: invoice.id, action: "issue", actor_id: "staff", created_at: "2026-10-23T03:11:00Z" },
    { id: 2, invoice_id: invoice.id, action: "payment", actor_id: "staff", created_at: payments[0].created_at },
    { id: 3, invoice_id: invoice.id, action: "payment", actor_id: "staff", created_at: payments[1].created_at },
  ], names);
  assert.equal(activity.length, 4);
  const payment = activity.find((item) => item.id === "payment-p1")!;
  assert.equal(payment.actor, "Sourav");
  assert.equal(payment.actorId, "staff");
  assert.equal(activity.find((item) => item.id === "invoice-invoice-1")?.actorId, "staff");
  assert.equal(activity.find((item) => item.id === "invoice-event-1")?.actorId, "staff");
  assert.equal(payment.createdAt, payments[0].created_at);
  assert.equal(payment.metadata?.find((field) => field.label === "Payment reference")?.value, "WIRE-1");
  assert.equal(payment.metadata?.find((field) => field.label === "Payment date")?.value, "2026-10-22");
  assert.match(payment.detail, /3,334\.00/);
  assert.equal(payment.href, "/invoices/invoice-1");
  assert.equal(payment.metadata?.find((field) => field.label === "Outstanding now")?.value, "$0.00");
});

test("mailbox and CRM copies deduplicate by message ID while unrelated emails remain", () => {
  const mail: ActivitySentMail = { id: "m1", user_id: "staff", from_email: "sales@example.com", to_email: "customer@example.com", subject: "Invoice", body: "Complete email copy", status: "sent", sent_at: "2026-10-23T03:12:00Z", message_id: "<same@example.com>", attachments: [{ filename: "invoice.pdf" }] };
  const mailbox = sentMailActivity([mail], names);
  const crm = { ...mailbox[0], id: "email-1", messageId: " <SAME@example.com> ", body: "CRM copy" };
  const other = { ...crm, id: "email-2", messageId: "<other@example.com>", createdAt: "2026-10-23T03:13:00Z" };
  const merged = mergeCompanyActivity([crm, other, ...mailbox]);
  assert.deepEqual(merged.map((item) => item.id), ["email-2", "mailbox-m1"]);
  assert.equal(merged[1].body, "Complete email copy");
  assert.equal(merged[1].actorId, "staff");
  assert.ok(merged[1].metadata?.some((field) => field.value === "invoice.pdf"));
  assert.equal(mergeCompanyActivity([{ ...crm, messageId: null }, { ...other, messageId: null }]).length, 2);
});

test("history reads past previous limits and reports failures instead of returning partial history", async () => {
  const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
  const ranges: number[][] = [];
  const result = await readActivityHistory(async (from, to) => { ranges.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; });
  assert.equal(result.length, 1203);
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
  await assert.rejects(readActivityHistory(async () => ({ data: null, error: { message: "Database unavailable" } })), /Database unavailable/);
});
