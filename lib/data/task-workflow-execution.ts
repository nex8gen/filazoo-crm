import "server-only";
import { randomUUID } from "node:crypto";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { taskWorkflowAccess, taskWorkflowDetail, processTaskWorkflows } from "./task-workflows";
import { getInvoice, mutateInvoice } from "./invoices";
import { canEditInvoice, canManageBilling } from "../invoice-permissions";
import { invoiceTotals, invoiceLabel } from "../invoices";
import { workflowSendBlockers, type TaskWorkAction, type TaskWorkflow, type WorkflowPayload } from "../task-workflows";
import { getViewerMailbox, mailboxHasSmtp } from "./mailboxes";
import { authorizeReplyRequest, type ReplyRequestRow } from "./customer-reply-requests";
import { latestWorkflowEvidence } from "./task-workflow-preparation";
import { deliverEmail } from "./manual-email-send";
import { canViewEmail } from "../email-access";
import { getAssignedEmailContacts } from "./email-access";
import { normalizeMessageId } from "../email-threading";

async function patch(work: TaskWorkflow, viewer: WorkspaceViewer, changes: Partial<TaskWorkflow>) {
  const { data } = await createSupabaseAdmin().from("crm_task_workflows").update({ ...changes, revision: work.revision + 1,
    last_actor_id: viewer.id, updated_at: new Date().toISOString() }).eq("task_id", work.task_id).eq("revision", work.revision).select("*").maybeSingle().throwOnError();
  if (!data) throw new Error("This task changed. Refresh it before trying again.");
  return data as TaskWorkflow;
}

async function currentSource(work: TaskWorkflow, viewer: WorkspaceViewer) {
  if (!work.request_id) return;
  const { data } = await createSupabaseAdmin().from("agent_reply_requests").select("*").eq("id", work.request_id).single().throwOnError();
  const request = data as ReplyRequestRow;
  await authorizeReplyRequest(viewer, request);
  if (request.status === "uncertain") throw new Error("The original request delivery is uncertain. Check Sent before continuing.");
  const latest = await latestWorkflowEvidence(viewer, request);
  if (latest.evidence && normalizeMessageId(latest.evidence.messageId) !== normalizeMessageId(work.payload.evidence?.messageId)) throw new Error("The customer sent a newer reply. Prepare this task again before applying details or sending.");
}

async function finish(work: TaskWorkflow, viewer: WorkspaceViewer, payload: WorkflowPayload) {
  const { data } = await createSupabaseAdmin().rpc("finish_task_workflow", { p_task: work.task_id, p_actor: viewer.id, p_revision: work.revision, p_payload: payload }).throwOnError();
  if (!data) throw new Error("The action finished, but task completion could not be confirmed. Refresh and check its delivery result.");
}

function revisedPayload(work: TaskWorkflow, changes: Partial<WorkflowPayload>): WorkflowPayload {
  const payload = { ...work.payload, ...changes };
  delete payload.deliveryId; delete payload.deliveryResult; delete payload.error;
  return payload;
}

export async function executeTaskWorkflow(viewer: WorkspaceViewer, taskId: string, input: TaskWorkAction) {
  const { task, workflow: work } = await taskWorkflowAccess(viewer, taskId, true);
  if (work.revision !== input.revision) throw new Error("This task changed. Refresh before taking action.");
  const db = createSupabaseAdmin();
  if (input.action === "check_delivery") {
    if (!["sending", "uncertain"].includes(work.status) || !work.payload.deliveryId) throw new Error("There is no saved delivery attempt to check.");
    const { data: operation } = await db.from("email_send_operations").select("status,result,user_id").eq("id", work.payload.deliveryId).eq("user_id", viewer.id).maybeSingle().throwOnError();
    if (operation?.status === "sent") await finish(work, viewer, { ...work.payload, deliveryResult: operation.result });
    else if ((!operation || operation.status === "failed") && Date.parse(work.lease_until ?? "") < Date.now()) await patch(work, viewer, { status: "ready", lease_until: null });
    else throw new Error(operation?.status === "uncertain" ? "SMTP delivery remains uncertain. Check Sent and the recipient; this task will not resend automatically." : "Delivery is still in progress. Wait before checking again.");
    return taskWorkflowDetail(viewer, taskId);
  }
  if (["sending", "uncertain"].includes(work.status)) throw new Error("Check the existing delivery before making another change.");
  if (work.lease_until && Date.parse(work.lease_until) > Date.now()) throw new Error("This task is being prepared. Wait for the current preparation to finish.");
  if (input.action === "prepare") {
    await patch(work, viewer, { status: "preparing", lease_until: null, blockers: [] });
    await processTaskWorkflows({ taskId, maxJobs: 1, budgetMs: 110_000 });
    return taskWorkflowDetail(viewer, taskId);
  }
  if (input.action === "snooze") {
    const due = Date.parse(input.dueAt);
    if (due <= Date.now() || due > Date.now() + 365 * 86400000) throw new Error("Choose a future date within one year.");
    const { data } = await db.from("crm_tasks").update({ due_at: input.dueAt }).eq("id", taskId).eq("status", "open").eq("updated_at", task.updated_at).select("id").maybeSingle().throwOnError();
    if (!data) throw new Error("The task changed. Refresh its due date.");
    await patch(work, viewer, {});
    return taskWorkflowDetail(viewer, taskId);
  }
  if (input.action === "save_draft") {
    await patch(work, viewer, { payload: revisedPayload(work, { subject: input.subject, text: input.text,
      input: { ...work.payload.input, kind: work.kind, subject: input.subject, text: input.text } }) });
    return taskWorkflowDetail(viewer, taskId);
  }
  if (input.action === "apply_details") {
    if (!Object.keys(input.changes).length) throw new Error("Choose at least one customer detail to save.");
    await currentSource(work, viewer);
    const { data } = await db.rpc("apply_task_workflow_details", { p_task: taskId, p_actor: viewer.id, p_revision: work.revision, p_changes: input.changes }).throwOnError();
    if (!data) throw new Error("The task or customer changed. Prepare the latest reply again.");
    return taskWorkflowDetail(viewer, taskId);
  }
  const invoice = work.invoice_id ? await getInvoice(work.invoice_id) : null;
  if (invoice && invoice.document.companyId !== task.company_id) throw new Error("The invoice is not linked to this customer.");
  if (input.action === "save_shipping") {
    if (!invoice || !canEditInvoice(viewer, invoice) || invoice.revision !== input.invoiceRevision) throw new Error("Only the current draft invoice can receive a shipping update. Refresh or ask its owner.");
    const document = { ...invoice.document, shippingMinor: input.shippingMinor };
    const saved = await mutateInvoice(invoice.id, viewer.id, { action: "save", revision: invoice.revision, document, totalMinor: invoiceTotals(document).total });
    await patch(work, viewer, { payload: revisedPayload(work, { shippingConfirmed: true, invoiceRevision: saved.revision,
      input: { ...work.payload.input, kind: work.kind, shippingMinor: input.shippingMinor } }) });
    return taskWorkflowDetail(viewer, taskId);
  }
  if (input.action === "complete") {
    if (!["customer_details", "reply_review"].includes(work.kind)) throw new Error("Use the task's send action to finish this work.");
    if (work.kind === "customer_details" && !work.payload.detailsApplied) throw new Error("Save the reviewed customer details before completing this task.");
    await finish(work, viewer, work.payload);
    return taskWorkflowDetail(viewer, taskId);
  }
  const blockers = workflowSendBlockers(work, invoice);
  if (blockers.length) throw new Error(blockers.join(" "));
  if (invoice && (invoice.revision !== input.invoiceRevision || invoice.revision !== work.payload.invoiceRevision)) throw new Error("The invoice changed since preparation. Review its current PDF and prepare the task again.");
  if (input.issue && (!invoice || !canManageBilling(viewer.role) || invoice.status !== "draft")) throw new Error("Only an operator or admin can issue the current draft invoice.");
  await currentSource(work, viewer);
  const mailbox = await getViewerMailbox(viewer.id, work.payload.mailboxId);
  if (!mailbox || !mailboxHasSmtp(mailbox)) throw new Error("The selected sending mailbox is unavailable.");
  const { data: contacts } = await db.from("contacts").select("email,unsubscribed").eq("company_id", task.company_id).throwOnError();
  const contact = contacts.find(c => c.email.toLowerCase() === work.payload.recipient!.toLowerCase());
  const assigned = await getAssignedEmailContacts(viewer);
  if (!contact || contact.unsubscribed || !canViewEmail(viewer, contact.email, assigned, mailbox)) throw new Error("The recipient is unavailable, unsubscribed, or no longer assigned to you.");
  const { count: suppressed } = await db.from("suppression").select("email", { count: "exact", head: true }).eq("email", contact.email.toLowerCase()).throwOnError();
  if (suppressed) throw new Error("This recipient is suppressed from email delivery.");
  let current = await patch(work, viewer, { status: "sending", lease_until: new Date(Date.now() + 5 * 60000).toISOString(),
    payload: { ...work.payload, deliveryId: work.payload.deliveryId ?? randomUUID() } });
  try {
    let outgoing = invoice;
    if (input.issue && outgoing) {
      outgoing = await mutateInvoice(outgoing.id, viewer.id, { action: "issue", revision: outgoing.revision });
      current = await patch(current, viewer, { payload: { ...current.payload, invoiceRevision: outgoing!.revision } });
    }
    const attachments = [];
    if (outgoing) {
      const { renderInvoicePdf } = await import("../invoice-pdf");
      const { invoicePdfFilename } = await import("../invoice-pdf-meta");
      const pdf = await renderInvoicePdf(outgoing, new Date().toISOString().slice(0, 10));
      const latestInvoice = await getInvoice(outgoing.id);
      if (!latestInvoice || latestInvoice.revision !== outgoing.revision) throw new Error("The invoice changed during PDF preparation. Review it before sending.");
      attachments.push({ filename: invoicePdfFilename(outgoing), contentType: "application/pdf", content: pdf.toString("base64") });
    }
    const { data: latestTask } = await db.from("crm_tasks").select("status,assigned_to").eq("id", taskId).single().throwOnError();
    if (latestTask.status !== "open" || (latestTask.assigned_to !== viewer.id && !canManageBilling(viewer.role))) throw new Error("The task was reassigned or closed before sending.");
    const response = await deliverEmail(viewer, { requestId: current.payload.deliveryId, mailboxId: mailbox.id, to: contact.email,
      subject: current.payload.subject, text: input.issue && outgoing ? current.payload.text!.replace(/draft invoice/gi, "invoice") : current.payload.text,
      inReplyTo: current.payload.inReplyTo, references: current.payload.references, threadId: current.payload.threadKey, attachments });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const { data: delivery } = await db.from("email_send_operations").select("status").eq("id", current.payload.deliveryId).eq("user_id", viewer.id).maybeSingle().throwOnError();
      await patch(current, viewer, { status: !delivery || delivery.status === "failed" ? "ready" : "uncertain", payload: { ...current.payload, error: result.error }, lease_until: null });
      throw new Error(result.error || "Email delivery could not be confirmed. Check Sent.");
    }
    await finish(current, viewer, { ...current.payload, deliveryResult: { sentAt: result.email?.timestamp, sentId: result.email?.id, messageId: result.email?.messageId, saved: result.saved,
      invoice: outgoing ? { id: outgoing.id, label: invoiceLabel(outgoing), revision: outgoing.revision } : null } });
  } catch (cause) {
    // A saved SMTP reservation is authoritative; never automatically repeat a possibly accepted email.
    const { data: delivery } = await db.from("email_send_operations").select("status").eq("id", current.payload.deliveryId).eq("user_id", viewer.id).maybeSingle();
    const { data: latest } = await db.from("crm_task_workflows").select("revision,status").eq("task_id", taskId).single();
    if (latest?.revision === current.revision && latest.status === "sending") await patch(current, viewer, {
      status: !delivery || delivery.status === "failed" ? "ready" : "uncertain", lease_until: null,
      payload: { ...current.payload, error: cause instanceof Error ? cause.message.slice(0, 600) : "Delivery needs review." } });
    throw cause;
  }
  return taskWorkflowDetail(viewer, taskId);
}
