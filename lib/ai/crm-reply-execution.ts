import "server-only";
import type { WorkspaceViewer } from "../auth";
import type { ReplyOperation } from "./crm-reply-tools";
import { cancelReplyRequest, ownedReplyRequest, prepareReplyRequest, startReplyRequest } from "../data/customer-reply-requests";

export async function replyOperationTarget(operation: ReplyOperation, viewer: WorkspaceViewer) {
  if (operation.op === "cancel_reply_request") {
    const row = await ownedReplyRequest(viewer, operation.requestId, true);
    return { name: row.company_name, value: { id: row.id, status: row.status, revision: row.revision }, preview: { recipient: row.recipient, subject: row.subject, revision: row.revision, effect: "Stop waiting. Preserve messages and existing tasks." } };
  }
  const ready = await prepareReplyRequest(operation, viewer);
  return { name: ready.company.fields.name, value: ready.fingerprint, preview: {
    recipient: ready.recipient, from: ready.mailbox.email, subject: ready.email?.subject ?? ready.source?.current?.subject,
    ...(ready.email ? { emailText: ready.email.text } : {}), needed: operation.needed, nextTask: operation.task,
    expiresInDays: operation.expiresInDays, invoiceContext: ready.snapshot, onReply: operation.onReply,
    effect: operation.op === "request_customer_information" ? "Send this request once and save a wait. A matching human reply creates one task and notification. No invoice is sent." : "Watch for new replies to this actual sent email. No email is resent. A matching human reply creates one task and notification.",
  } };
}
export async function executeReplyOperation(operation: ReplyOperation, viewer: WorkspaceViewer, actionId: string, preview: Record<string, unknown>) {
  return operation.op === "cancel_reply_request"
    ? cancelReplyRequest(viewer, operation.requestId, Number(preview.revision))
    : startReplyRequest(operation, viewer, actionId);
}
