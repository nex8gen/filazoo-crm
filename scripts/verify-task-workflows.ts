// Real Supabase + AI + SMTP + IMAP verification, confined to one labelled QA company
// and the already-connected workspace mailbox sending only to itself.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createSupabaseAdmin } from "../lib/supabase/admin";
import { normalizeMailboxRow } from "../lib/mailbox-utils";
import { workflowOwner } from "../lib/data/task-workflow-preparation";
import { startReplyRequest } from "../lib/data/customer-reply-requests";
import { replyOperationSchema } from "../lib/ai/crm-reply-tools";
import { processCustomerReplies } from "../lib/data/customer-reply-worker";
import { processTaskWorkflows, taskWorkflowDetail } from "../lib/data/task-workflows";
import { executeTaskWorkflow } from "../lib/data/task-workflow-execution";
import { sendMailboxEmail } from "../lib/mailer";
import { receiveMailboxMessages, closeMailboxSessions, withMailboxSyncSessions } from "../lib/mailbox-imap";
import { loadSyncedMailbox } from "../lib/data/mailbox-sync";
import { replyTaskEvidence, replyTaskNotes } from "../lib/customer-reply-workflow";
import { invoiceProduct } from "../lib/invoice-links";
import { userProductRows } from "../lib/data/product-personalization";
import { createAgentTask } from "../lib/data/agent-tasks";

const checkpointPath = "tmp/task-workflow-live-checkpoint.json";
const evidencePath = "docs/audit-evidence/task-workflows-live-20261030.json";
type Checkpoint = { requestId: string; companyId: string; followupId: string; detailsId: string; phase?: string; requestSent?: boolean; replySent?: boolean; syntheticHandoff?: boolean; failures?: string[]; results?: Record<string, unknown> };
mkdirSync("tmp", { recursive: true });
const checkpoint: Checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, "utf8")) : { requestId: randomUUID(), companyId: randomUUID(), followupId: randomUUID(), detailsId: randomUUID() };
const save = () => { writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2)); };
const db = createSupabaseAdmin();
async function receipt(mailbox: NonNullable<ReturnType<typeof normalizeMailboxRow>>, messageId: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const messages = await receiveMailboxMessages(mailbox, { limit: 25, headersOnly: true, includePreview: false });
    const found = messages.find(message => message.messageId?.toLowerCase() === messageId.toLowerCase());
    if (found) return found;
    await closeMailboxSessions();
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error("The test message did not arrive in the owned mailbox.");
}
async function main() {
  if (process.argv.includes("--live") && checkpoint.phase === "complete") {
    console.log(JSON.stringify({ phase: "already-complete", ...checkpoint.results }));
    return;
  }
  const { data: sender } = await db.from("workspace_mailboxes").select("*").eq("type", "workspace").eq("is_default", true).eq("is_active", true).single().throwOnError();
  const mailbox = normalizeMailboxRow(sender);
  assert.ok(mailbox?.email && mailbox.smtpHost && mailbox.imapHost);
  assert.equal(mailbox.email.toLowerCase(), "raul@filazoo.com", "The live test is confined to the existing owned QA mailbox.");
  const { data: member } = await db.from("workspace_members").select("user_id").eq("role", "admin").eq("display_name", "Sourav Mallick").not("activated_at", "is", null).single().throwOnError();
  const viewer = await workflowOwner(member.user_id);
  const products = (await userProductRows(viewer.id)).filter(product => product.active && Number(product.price) > 0);
  assert.ok(products.length);
  const product = invoiceProduct({ ...products[0], tags: products[0].tags ?? [] });
  const item = { productSku: product.sku, variantId: product.variants[0]?.id ?? null, quantity: Math.max(1, product.moq) };
  console.log(JSON.stringify({ phase: "preflight", connectedDatabase: true, ownedMailbox: true, activeProduct: item.productSku, checkpoint: checkpoint.requestId }));
  if (!process.argv.includes("--live")) return;
  save();
  await db.from("companies").upsert({ id: checkpoint.companyId, name: `[QA] Actionable task verification ${checkpoint.requestId.slice(0, 8)}`, source: "internal_qa", country: "United States", segment: "Internal verification" }, { onConflict: "id", ignoreDuplicates: true }).throwOnError();
  const { data: existingContact } = await db.from("contacts").select("id").eq("company_id", checkpoint.companyId).eq("email", mailbox.email).maybeSingle().throwOnError();
  if (!existingContact) await db.from("contacts").insert({ company_id: checkpoint.companyId, email: mailbox.email, name: "Internal QA", verification_status: "valid" }).throwOnError();
  const subject = `[Filazoo task QA ${checkpoint.requestId.slice(0, 8)}] Confirm synthetic shipping address`;
  const input = replyOperationSchema.parse({ op: "request_customer_information", companyId: checkpoint.companyId, recipient: mailbox.email, mailboxId: mailbox.id,
    needed: ["shipping_address", "billing_address"], mode: "confirm", subject,
    text: "Internal software verification only. Please reply with the synthetic address: QA Recipient, 99 Synthetic Test Road, Boston, MA 02110, United States. Confirm this test address for billing and shipping. No real purchase or payment is requested.",
    task: { title: `[QA] Preview and send the prepared invoice ${checkpoint.requestId.slice(0, 8)}`, notes: `Internal software verification, not a sale. Prepare a draft for ${item.quantity} units of product ${item.productSku}, variant ${item.variantId ?? "none"}. The reply supplies synthetic shipping and billing details. Never issue this test invoice.`, priority: "normal" },
    onReply: { kind: "invoice_review", items: [item] }, expiresInDays: 1 });
  assert.notEqual(input.op, "cancel_reply_request");
  const { data: registered } = await db.from("agent_reply_requests").select("id,status,message_id").eq("id", checkpoint.requestId).maybeSingle().throwOnError();
  if (!registered) {
    assert.ok(!checkpoint.requestSent, "An interrupted request must be checked before resending.");
    checkpoint.requestSent = true; save();
    await startReplyRequest(input as Exclude<typeof input, { op: "cancel_reply_request" }>, viewer, checkpoint.requestId);
  }
  const { data: request } = await db.from("agent_reply_requests").select("*").eq("id", checkpoint.requestId).single().throwOnError();
  assert.ok(["waiting", "received"].includes(request.status), `Request status needs review: ${request.status}`);
  const firstReceipt = await receipt(mailbox, request.message_id);
  assert.ok(firstReceipt);
  console.log(JSON.stringify({ phase: "request-received", direction: firstReceipt.direction }));
  if (!checkpoint.replySent) {
    checkpoint.replySent = true; save();
    await sendMailboxEmail({ host: mailbox.smtpHost!, port: mailbox.smtpPort!, user: mailbox.smtpUsername!, pass: mailbox.smtpPassword!, from: mailbox.email }, {
      to: mailbox.email, subject: `Re: ${subject}`, inReplyTo: request.message_id, references: [request.message_id], messageId: `<qa-reply-${checkpoint.requestId}@filazoo.com>`,
      text: "Hello,\n\nFor this internal software verification only, use the following synthetic details for BOTH billing and shipping:\nQA Recipient\n99 Synthetic Test Road\nBoston, MA 02110\nUnited States\nPhone: +1 202 555 0100\n\nThis is not a purchase. Please prepare a draft PDF only for the internal QA mailbox.\n\nOn an earlier date we wrote:\nOld quoted address: 88 Obsolete Street, London, United Kingdom." });
  }
  const replyReceipt = await receipt(mailbox, `<qa-reply-${checkpoint.requestId}@filazoo.com>`);
  assert.ok(replyReceipt);
  console.log(JSON.stringify({ phase: "reply-received", direction: replyReceipt.direction }));
  await loadSyncedMailbox(mailbox, { sync: true, includeContent: false });
  await processCustomerReplies({ mailboxId: mailbox.id, budgetMs: 90_000 });
  let { data: handedOff } = await db.from("agent_reply_requests").select("status,task_id").eq("id", checkpoint.requestId).single().throwOnError();
  if (handedOff.status === "waiting" && replyReceipt.direction === "outbound" && replyReceipt.from?.toLowerCase() === mailbox.email.toLowerCase()) {
    // Self-mail is correctly outbound. Do not weaken production matching for QA.
    // Feed its real received headers/body through the validated database handoff as
    // an explicitly labelled synthetic inbound-event boundary, then test real work.
    const [actualReply] = await receiveMailboxMessages(mailbox, { uids: [replyReceipt.uid!], uidValidity: replyReceipt.uidValidity, headersOnly: false });
    assert.ok(actualReply && actualReply.inReplyTo === request.message_id);
    const evidence = replyTaskEvidence(actualReply);
    const { data: accepted } = await db.rpc("finish_agent_reply_request", { p_id: request.id, p_user_id: viewer.id, p_revision: request.revision,
      p_outcome: "received", p_evidence: evidence, p_notes: `[QA synthetic event boundary: self-mail was correctly classified outbound.]\n${replyTaskNotes(request, evidence)}`, p_thread_url: `/email?mailbox=${mailbox.id}` }).throwOnError();
    assert.equal(accepted, true); checkpoint.syntheticHandoff = true; save();
    ({ data: handedOff } = await db.from("agent_reply_requests").select("status,task_id").eq("id", checkpoint.requestId).single().throwOnError());
  }
  assert.equal(handedOff.status, "received"); assert.equal(handedOff.task_id, checkpoint.requestId);
  const workerResult = await processTaskWorkflows({ taskId: checkpoint.requestId, maxJobs: 1, budgetMs: 110_000 });
  let detail = await taskWorkflowDetail(viewer, checkpoint.requestId);
  if (detail.workflow.status === "blocked") detail = await executeTaskWorkflow(viewer, checkpoint.requestId, { action: "prepare", revision: detail.workflow.revision });
  console.log(JSON.stringify({ phase: "prepared", workerResult, status: detail.workflow.status, blockers: detail.workflow.blockers, invoice: detail.invoice?.id }));
  assert.ok(detail.invoice, JSON.stringify(detail.workflow.blockers));
  assert.match(detail.invoice.document.shippingAddress!, /99 Synthetic Test Road/i);
  assert.match(detail.invoice.document.customerAddress, /99 Synthetic Test Road/i);
  assert.doesNotMatch(detail.invoice.document.shippingAddress!, /Obsolete|London/i);
  assert.equal(detail.invoice.status, "draft");
  const { renderInvoicePdf } = await import("../lib/invoice-pdf");
  const pdf = await renderInvoicePdf(detail.invoice, new Date().toISOString().slice(0, 10));
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF"); assert.ok(pdf.length > 1000);
  mkdirSync("tmp/pdfs", { recursive: true }); writeFileSync("tmp/pdfs/task-workflow-qa.pdf", pdf);
  if (detail.workflow.status !== "done") {
    if (detail.workflow.blockers.length) detail = await executeTaskWorkflow(viewer, checkpoint.requestId, { action: "prepare", revision: detail.workflow.revision });
    assert.equal(detail.workflow.blockers.length, 0, JSON.stringify(detail.workflow.blockers));
    if (!detail.workflow.payload.shippingConfirmed) detail = await executeTaskWorkflow(viewer, checkpoint.requestId, { action: "save_shipping", revision: detail.workflow.revision, invoiceRevision: detail.invoice!.revision, shippingMinor: 0 });
    const stale = detail.workflow.revision - 1;
    await assert.rejects(() => executeTaskWorkflow(viewer, checkpoint.requestId, { action: "send", revision: stale, invoiceRevision: detail.invoice!.revision, issue: false }), /changed/);
    detail = await executeTaskWorkflow(viewer, checkpoint.requestId, { action: "send", revision: detail.workflow.revision, invoiceRevision: detail.invoice!.revision, issue: false });
  }
  assert.equal(detail.workflow.status, "done"); assert.equal(detail.taskStatus, "done");
  const delivery = detail.workflow.payload.deliveryResult;
  assert.ok(delivery?.messageId, "SMTP acceptance must be recorded with an RFC message ID.");
  const received = await receipt(mailbox, String(delivery.messageId));
  assert.ok(received.attachments?.some(attachment => /\.pdf$/i.test(attachment.filename)), "The actual received MIME must contain the invoice PDF.");
  await assert.rejects(() => executeTaskWorkflow(viewer, checkpoint.requestId, { action: "send", revision: detail.workflow.revision, invoiceRevision: detail.invoice!.revision, issue: false }), /open task/);
  const { count: alerts } = await db.from("internal_notifications").select("id", { count: "exact", head: true }).eq("task_id", checkpoint.requestId).throwOnError();
  const { count: unread } = await db.from("internal_notifications").select("id", { count: "exact", head: true }).eq("task_id", checkpoint.requestId).is("read_at", null).throwOnError();
  assert.equal(alerts, 1); assert.equal(unread, 0);
  await createAgentTask(viewer, checkpoint.followupId, { op: "create_task", title: "[QA] Follow-up action controls", companyId: checkpoint.companyId, notes: "Internal follow-up test. No customer delivery.", workflow: { kind: "email_follow_up", subject: "Internal follow-up preview", text: "Internal QA only. No real order is requested." } });
  await processTaskWorkflows({ taskId: checkpoint.followupId, maxJobs: 1 });
  const followup = await taskWorkflowDetail(viewer, checkpoint.followupId);
  assert.equal(followup.workflow.status, "ready"); assert.equal(followup.workflow.payload.subject, "Internal follow-up preview");
  await createAgentTask(viewer, checkpoint.detailsId, { op: "create_task", title: "[QA] Customer detail review controls", companyId: checkpoint.companyId, notes: "Internal data review, not a real customer.", workflow: { kind: "customer_details" } });
  await processTaskWorkflows({ taskId: checkpoint.detailsId, maxJobs: 1 });
  let details = await taskWorkflowDetail(viewer, checkpoint.detailsId);
  details = await executeTaskWorkflow(viewer, checkpoint.detailsId, { action: "apply_details", revision: details.workflow.revision, changes: { shippingAddress: "99 Synthetic Test Road, Boston, MA 02110, United States" } });
  details = await executeTaskWorkflow(viewer, checkpoint.detailsId, { action: "complete", revision: details.workflow.revision });
  assert.equal(details.taskStatus, "done");
  checkpoint.phase = "complete";
  checkpoint.results = { testedAt: new Date().toISOString(), companyId: checkpoint.companyId, taskId: checkpoint.requestId, invoiceId: detail.invoice!.id,
    validatedReplyHandoff: true, selfMailSyntheticEventBoundary: Boolean(checkpoint.syntheticHandoff), automaticExternalInboundMatchingProvenByThisLiveTest: false,
    draftInvoiceFromReply: true, oldQuotedAddressIgnored: true, pdfBytes: pdf.length, smtpAccepted: true, imapReceivedPdf: true,
    duplicateSendBlocked: true, notificationCount: alerts, unreadAfterCompletion: unread, followupReady: true, customerDetailsSavedAndCompleted: true,
    invoiceStatus: detail.invoice!.status, sentToOwnedMailboxOnly: true, receivedPdf: received.attachments?.filter(a => /\.pdf$/i.test(a.filename)).map(a => ({ filename: a.filename, size: a.size })) };
  save(); mkdirSync("docs/audit-evidence", { recursive: true }); writeFileSync(evidencePath, JSON.stringify(checkpoint.results, null, 2));
  console.log(JSON.stringify({ phase: "PASS", ...checkpoint.results }));
}
void withMailboxSyncSessions(main, 50_000).catch(error => { checkpoint.failures ??= []; checkpoint.failures.push(error instanceof Error ? error.message : String(error)); save(); console.error(error); process.exitCode = 1; }).finally(() => closeMailboxSessions());
