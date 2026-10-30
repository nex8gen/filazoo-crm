import assert from "node:assert/strict";
import test from "node:test";
import { groundedReplyChanges, workflowAddress, taskWorkflowInputSchema, taskWorkActionSchema, workflowSendBlockers, type TaskWorkflow } from "../lib/task-workflows.ts";
import { blankInvoiceDocument, type Invoice } from "../lib/invoices.ts";
import { productivityOperationSchema } from "../lib/ai/crm-productivity.ts";
import { replyOperationSchema } from "../lib/ai/crm-reply-tools.ts";
import { splitQuotedEmail } from "../lib/email-content.ts";
const id = "a1111111-1111-4111-8111-111111111111";
function work(kind: TaskWorkflow["kind"] = "invoice_review"): TaskWorkflow {
  return { task_id: id, owner_id: id, kind, status: "ready", revision: 1, invoice_id: id, request_id: null, payload: { recipient: "buyer@example.com", mailboxId: id, subject: "Invoice", text: "Please review." }, blockers: [], lease_until: null, created_at: "2026-10-30", updated_at: "2026-10-30" };
}
const invoice: Invoice = { id, number: 1, document: { ...blankInvoiceDocument("2026-10-30"), customerName: "QA", customerEmail: "buyer@example.com", customerAddress: "Billing office", shippingAddress: "99 Test Road", items: [{ description: "PLA", quantity: 1, unitPriceMinor: 1000, taxBps: 0 }] }, total_minor: 1000, paid_minor: 0, revision: 1, status: "draft", created_at: "2026-10-30", updated_at: "2026-10-30" };

test("AI tasks require explicit structured actions and a company; arbitrary endpoints and model prices are refused", () => {
  assert.equal(productivityOperationSchema.safeParse({ op: "create_task", title: "Invoice", workflow: { kind: "invoice_review" } }).success, false);
  assert.equal(productivityOperationSchema.safeParse({ op: "create_task", title: "Invoice", companyId: id, workflow: { kind: "invoice_review", items: [{ productSku: "PLA", variantId: "red", quantity: 100 }] } }).success, true);
  for (const extra of [{ url: "https://attacker.invalid/send" }, { autoSend: true }, { shippingMinor: -1 }, { invoiceId: "invented" }, { items: [{ productSku: "PLA", quantity: 1, unitPriceMinor: 1 }] }]) assert.equal(taskWorkflowInputSchema.safeParse({ kind: "invoice_review", ...extra }).success, false);
  assert.equal(replyOperationSchema.safeParse({ op: "request_customer_information", companyId: id, needed: ["shipping_address"], subject: "Address", text: "Please confirm", task: { title: "Prepare invoice", notes: "Draft for review" }, onReply: { kind: "invoice_review", items: [{ productSku: "PLA", quantity: 100, variantId: "red" }] } }).success, true);
});

test("invoice sending requires a current draft, confirmed shipping, billing details and a prepared email", () => {
  const state = work();
  assert.match(workflowSendBlockers(state, invoice).join(" "), /Confirm the shipping/);
  assert.match(workflowSendBlockers(state, null).join(" "), /Prepare an invoice/);
  state.payload.shippingConfirmed = true;
  assert.deepEqual(workflowSendBlockers(state, invoice), []);
  assert.match(workflowSendBlockers(state, { ...invoice, status: "void" }).join(" "), /void/);
  assert.match(workflowSendBlockers(state, { ...invoice, document: { ...invoice.document, customerAddress: "" } }).join(" "), /billing address/);
  state.payload.text = "";
  assert.match(workflowSendBlockers(state, invoice).join(" "), /outgoing email/);
});

test("payment follow-ups disappear for paid, void and draft invoices", () => {
  const state = work("payment_follow_up");
  assert.match(workflowSendBlockers(state, invoice).join(" "), /outstanding balance/);
  assert.deepEqual(workflowSendBlockers(state, { ...invoice, status: "issued" }), []);
  for (const change of [{ status: "void" as const }, { status: "issued" as const, paid_minor: 1000 }, { status: "issued" as const, paid_minor: 1200 }]) assert.match(workflowSendBlockers(state, { ...invoice, ...change }).join(" "), /outstanding balance/);
});

test("a country or city fallback never unlocks invoice billing or shipping", () => {
  const location = { city: "Boston", country: "United States" };
  for (const address of ["United States", "Boston", "Boston, United States", "Boston\nUnited States", ""]) assert.equal(workflowAddress(address, location), "");
  assert.equal(workflowAddress("99 Test Road, Boston, United States", location), "99 Test Road, Boston, United States");
  const state = work(); state.payload.shippingConfirmed = true; state.payload.companyLocation = location;
  assert.match(workflowSendBlockers(state, { ...invoice, document: { ...invoice.document, customerAddress: "United States" } }).join(" "), /billing address/);
  assert.match(workflowSendBlockers(state, { ...invoice, document: { ...invoice.document, shippingAddress: "Boston, United States" } }).join(" "), /complete shipping address/);
});

test("extracted customer details must occur in the newest reply, never old quoted history", () => {
  const body = "Please ship to 99 New Test Road, Boston, MA 02110.\nPhone: +1 202 555 0100\n\nOn Oct 1, the customer wrote:\n88 Obsolete Street, London";
  const newest = splitQuotedEmail(body).current;
  const changes = groundedReplyChanges({ shippingAddress: "99 New Test Road, Boston, MA 02110", shippingPhone: "+1 202 555 0100", address: "88 Obsolete Street, London", taxId: "Invented123" }, newest);
  assert.equal(changes.shippingAddress, "99 New Test Road, Boston, MA 02110");
  assert.equal(changes.shippingPhone, "+1 202 555 0100");
  assert.equal(changes.address, undefined); assert.equal(changes.taxId, undefined);
  assert.equal(groundedReplyChanges({ address: "99 New Test Road\\nBoston, MA 02110" }, newest).address, "99 New Test Road\nBoston, MA 02110");
});

test("action payloads reject header injection, arbitrary writes, missing revisions and non-integer money", () => {
  for (const input of [{ action: "send" }, { action: "send", revision: 0 }, { action: "save_draft", revision: 1, subject: "Hi\nBcc: attacker@example.com", text: "Hi" }, { action: "apply_details", revision: 1, changes: { ownerId: id } }, { action: "save_shipping", revision: 1, invoiceRevision: 1, shippingMinor: 12.5 }, { action: "execute", revision: 1, code: "delete all" }]) assert.equal(taskWorkActionSchema.safeParse(input).success, false);
  assert.equal(taskWorkActionSchema.safeParse({ action: "send", revision: 3, invoiceRevision: 4, issue: false }).success, true);
});
