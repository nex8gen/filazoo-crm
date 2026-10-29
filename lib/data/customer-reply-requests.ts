import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { getViewerMailbox, getViewerMailboxes, mailboxHasImap, mailboxHasSmtp } from "./mailboxes";
import { canViewEmail } from "../email-access";
import { getAssignedEmailContacts } from "./email-access";
import { loadAgentCompany, loadAgentEmails, prepareAgentEmail } from "../ai/agent-records";
import { AgentClarificationError, preparedAgentActionSchema, preparedAgentEmailSchema } from "../ai/agent-actions";
import { getInvoice } from "./invoices";
import { canReadInvoices } from "../invoice-permissions";
import type { ReplyRequestInput } from "../ai/crm-reply-tools";
import { sendMailboxEmail } from "../mailer";
import { prepareUserEmail } from "./email-footers";
import { stopAutoReplyForManualSend } from "./email-auto-reply";
import { normalizeMessageId, threadKeyForEmail } from "../email-threading";
import { replyRequestThreadUrl, type ReplyRequestSummary, type ReplyRequestStatus } from "../customer-reply-workflow";
import type { InvoiceDocument } from "../invoices";

export type ReplyRequestRow = Omit<ReplyRequestSummary, "thread_url"> & {
  user_id: string; owner_role: string; mailbox_id: string | null; body: string; task_notes: string; task_priority: string;
  scope_key: string; revision: number; message_id: string | null; thread_key: string | null;
  waiting_since: string | null; send_started_at: string | null; sent_record_id: string | null;
  invoice_id: string | null; invoice_context: unknown; updated_at: string;
};
export const replyRequestListFields = "id,user_id,owner_role,company_id,company_name,mailbox_id,recipient,subject,needed,task_title,status,created_at,expires_at,last_checked_at,last_error,task_id,thread_key";
const active = ["preparing", "sending", "waiting", "uncertain"];
function canWrite(viewer: WorkspaceViewer) {
  if (!["admin", "operator", "bd_manager"].includes(viewer.role)) throw new Error("Your workspace role cannot manage customer reply requests.");
}
export async function authorizeReplyRequest(viewer: WorkspaceViewer, row: Pick<ReplyRequestRow, "user_id" | "owner_role" | "mailbox_id" | "recipient" | "company_id">) {
  canWrite(viewer);
  if (row.user_id !== viewer.id || row.owner_role !== viewer.role) throw new Error("This waiting request is unavailable for your current account and role.");
  if (!row.mailbox_id) throw new Error("The receiving mailbox was removed.");
  const mailbox = await getViewerMailbox(viewer.id, row.mailbox_id);
  if (!mailbox || !mailboxHasImap(mailbox)) throw new Error("The receiving mailbox is stopped or unavailable.");
  const db = createSupabaseAdmin();
  const { data: contacts, error } = await db.from("contacts").select("id,email").eq("company_id", row.company_id).ilike("email", row.recipient.replace(/[\\%_]/g, "\\$&")).limit(2);
  if (error || !contacts?.length) throw new Error("This email no longer belongs to the selected customer.");
  if (viewer.role === "bd_manager" && mailbox.type === "workspace") {
    const { data } = await db.from("pipeline").select("company_id").eq("company_id", row.company_id).eq("owner_id", viewer.id).maybeSingle().throwOnError();
    if (!data) throw new Error("This customer is no longer assigned to you.");
  }
  return mailbox;
}
export function presentReplyRequest(row: ReplyRequestRow): ReplyRequestSummary {
  return { id: row.id, company_id: row.company_id, company_name: row.company_name, recipient: row.recipient, subject: row.subject,
    needed: row.needed, task_title: row.task_title, status: row.status, created_at: row.created_at, expires_at: row.expires_at,
    last_checked_at: row.last_checked_at, last_error: row.last_error, task_id: row.task_id,
    thread_url: replyRequestThreadUrl(row.mailbox_id, row.thread_key),
  };
}
export async function listReplyRequests(viewer: WorkspaceViewer, filters: { id?: string; query?: string; companyId?: string } = {}) {
  canWrite(viewer);
  let query = createSupabaseAdmin().from("agent_reply_requests").select(replyRequestListFields).eq("user_id", viewer.id).eq("owner_role", viewer.role).order("created_at", { ascending: false }).limit(50);
  if (filters.id) query = query.eq("id", filters.id);
  if (filters.companyId) query = query.eq("company_id", filters.companyId);
  const { data, error } = await query;
  if (error) throw new Error("Unable to load waiting requests. Check the customer-reply workflow database setup.");
  const [assigned, mailboxes] = await Promise.all([getAssignedEmailContacts(viewer), getViewerMailboxes(viewer.id)]);
  const visible: ReplyRequestSummary[] = [];
  for (const row of (data ?? []) as ReplyRequestRow[]) {
    const mailbox = mailboxes.find((item) => item.id === row.mailbox_id);
    if (mailbox && !canViewEmail(viewer, row.recipient, assigned, mailbox)) continue;
    if (filters.query && !`${row.company_name} ${row.recipient} ${row.subject} ${row.task_title}`.toLowerCase().includes(filters.query.toLowerCase())) continue;
    visible.push(presentReplyRequest(row));
  }
  return visible;
}
export async function ownedReplyRequest(viewer: WorkspaceViewer, id: string, cancellation = false) {
  z.uuid().parse(id); canWrite(viewer);
  const { data } = await createSupabaseAdmin().from("agent_reply_requests").select("*").eq("id", id).eq("user_id", viewer.id).maybeSingle().throwOnError();
  if (!data) throw new Error("Waiting request not found.");
  if (!cancellation) await authorizeReplyRequest(viewer, data as ReplyRequestRow);
  return data as ReplyRequestRow;
}
function planningSnapshot(document: InvoiceDocument, proposalId?: string) {
  return { ...(proposalId ? { proposalId } : {}), companyId: document.companyId, customerName: document.customerName, currency: document.currency,
    reference: document.reference, items: document.items.map(({ description, quantity, unitPriceMinor, productSku, variantId }) => ({ description, quantity, unitPriceMinor, productSku, variantId })),
    shippingRecipient: document.shippingRecipient, shippingAddress: document.shippingAddress, shippingPhone: document.shippingPhone, shippingMinor: document.shippingMinor,
    notes: document.notes, warning: "Historical planning context only. Recheck current customer instructions, prices, shipping charge and approval before invoicing or sending." };
}
async function invoiceContext(input: ReplyRequestInput, viewer: WorkspaceViewer) {
  if (input.invoiceId && input.invoiceProposalId) throw new AgentClarificationError("Should I keep the saved invoice or the pending invoice proposal as context for the follow-up?");
  if (!input.invoiceId && !input.invoiceProposalId) return null;
  if (!canReadInvoices(viewer.role)) throw new Error("Your role cannot read invoice details.");
  if (input.invoiceId) {
    const invoice = await getInvoice(input.invoiceId);
    if (!invoice || invoice.document.companyId !== input.companyId) throw new Error("Choose an invoice belonging to this customer.");
    return planningSnapshot(invoice.document);
  }
  const { data } = await createSupabaseAdmin().from("workspace_agent_actions").select("action,status,expires_at").eq("id", input.invoiceProposalId!).eq("user_id", viewer.id).maybeSingle().throwOnError();
  const parsed = preparedAgentActionSchema.safeParse(data?.action);
  if (!data || data.status !== "pending" || Date.parse(data.expires_at) <= Date.now() || !parsed.success || !["create_invoice", "update_invoice", "send_invoice"].includes(parsed.data.type) || !("document" in parsed.data) || parsed.data.document.companyId !== input.companyId)
    throw new Error("Choose a current invoice proposal belonging to you and this customer.");
  return planningSnapshot(parsed.data.document, input.invoiceProposalId);
}
export async function prepareReplyRequest(input: ReplyRequestInput, viewer: WorkspaceViewer) {
  canWrite(viewer);
  const company = await loadAgentCompany(input.companyId);
  const snapshot = await invoiceContext(input, viewer);
  const source = input.sourceEmailId ? await loadAgentEmails(viewer, input.sourceEmailId, undefined, input.mailboxId) : null;
  const recipient = ((input.op === "request_customer_information" ? input.recipient : undefined) || source?.current?.contact || company.fields.contactEmail || "").trim().toLowerCase();
  if (!recipient || !company.contacts.some((contact) => contact.email.trim().toLowerCase() === recipient)) throw new AgentClarificationError("Which saved customer contact should receive the request? Add or choose their business email first.");
  const mailbox = await getViewerMailbox(viewer.id, source?.mailboxId || input.mailboxId);
  if (!mailbox || !z.uuid().safeParse(mailbox.id).success || !mailboxHasImap(mailbox) || (input.op === "request_customer_information" && !mailboxHasSmtp(mailbox)))
    throw new Error("Connect an active mailbox with incoming email and SMTP before sending a request and waiting for its reply.");
  await authorizeReplyRequest(viewer, { user_id: viewer.id, owner_role: viewer.role, mailbox_id: mailbox.id, company_id: input.companyId, recipient });
  if (source?.current && source.current.contact.trim().toLowerCase() !== recipient) throw new Error("The selected email belongs to another recipient.");
  if (input.op === "request_customer_information" && input.mode === "missing") {
    const known = input.needed.includes("shipping_address") && company.fields["commerce.shippingAddress"]
      || input.needed.includes("billing_address") && company.fields["commerce.address"]
      || input.needed.includes("tax_id") && company.fields["commerce.taxId"];
    if (known) throw new AgentClarificationError(`This customer already has the requested saved detail: ${known}. Should I use it, or explicitly ask the customer to confirm it?`);
  }
  if (input.op === "wait_for_customer_reply" && (!source?.current || source.current.direction !== "outbound" || !source.current.messageId)) throw new AgentClarificationError("Which actual sent email should I watch for new replies? Choose it from Sent first.");
  const email = input.op === "request_customer_information" ? preparedAgentEmailSchema.parse(await prepareAgentEmail({ to: recipient, subject: input.subject, text: input.text, delivery: "send", ...(input.sourceEmailId ? { sourceEmailId: input.sourceEmailId, mailboxId: mailbox.id } : { mailboxId: mailbox.id }) }, viewer)) : null;
  return { company, mailbox, recipient, snapshot, source, email,
    fingerprint: { company: company.fingerprint, mailboxId: mailbox.id, sender: mailbox.email, recipient, snapshot, source: source?.current ? { id: source.current.id, messageId: source.current.messageId } : null },
  };
}

export async function startReplyRequest(input: ReplyRequestInput, viewer: WorkspaceViewer, actionId: string) {
  const ready = await prepareReplyRequest(input, viewer);
  const { company, mailbox, recipient, snapshot, source, email } = ready;
  const db = createSupabaseAdmin();
  const now = new Date().toISOString();
  const messageId = input.op === "request_customer_information" ? `<filazoo-info-${actionId}@${mailbox.email.split("@")[1]}>` : source!.current!.messageId!;
  const scopeKey = createHash("sha256").update(JSON.stringify([viewer.id, input.companyId, mailbox.id, recipient, [...input.needed].sort(), input.invoiceId || input.invoiceProposalId || null])).digest("hex");
  const threadKey = email?.threadId || source?.current && threadKeyForEmail(source.current) || `message:${normalizeMessageId(messageId)}`;
  const status: ReplyRequestStatus = input.op === "request_customer_information" ? "sending" : "waiting";
  const row = { id: actionId, user_id: viewer.id, owner_role: viewer.role, company_id: input.companyId, company_name: company.fields.name,
    mailbox_id: mailbox.id, recipient, subject: input.op === "request_customer_information" ? input.subject : source!.current!.subject,
    body: input.op === "request_customer_information" ? input.text : "", needed: input.needed, task_title: input.task.title, task_notes: input.task.notes,
    task_priority: input.task.priority, invoice_id: input.invoiceId ?? null, invoice_context: snapshot, scope_key: scopeKey, status,
    revision: 1, message_id: normalizeMessageId(messageId), thread_key: threadKey, waiting_since: now,
    send_started_at: input.op === "request_customer_information" ? now : null, expires_at: new Date(Date.now() + input.expiresInDays * 86400000).toISOString(),
  };
  const { error } = await db.from("agent_reply_requests").insert(row);
  if (error) throw new Error(error.code === "23505" ? "This request is already registered. Check Waiting on customers before sending another email." : "Unable to save the waiting request. No email was sent.");
  if (!email) return { success: "Waiting for a new reply to the selected sent email. A matching human reply will create one review task; no email was resent.", requestId: actionId, href: "/tasks" };
  try {
    if (email.inReplyTo || email.references?.length) await stopAutoReplyForManualSend(viewer, [...(email.references ?? []), ...(email.inReplyTo ? [email.inReplyTo] : [])], recipient);
    const content = await prepareUserEmail(viewer.id, { text: email.text });
    const stored = [];
    for (const [index, attachment] of content.attachments.entries()) {
      const path = `${viewer.id}/${actionId}/${index}`;
      const { error: uploadError } = await db.storage.from("mailbox-attachments").upload(path, attachment.content, { contentType: attachment.contentType, upsert: false });
      if (uploadError) throw new Error("Unable to store the email footer.");
      stored.push({ filename: attachment.filename, contentType: attachment.contentType, size: attachment.content.length, path, cid: attachment.cid });
    }
    const sent = await sendMailboxEmail({ host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email },
      { to: recipient, subject: input.op === "request_customer_information" ? input.subject : "", ...content, messageId, inReplyTo: email.inReplyTo, references: email.references });
    const actualMessageId = normalizeMessageId(sent.messageId);
    if (!actualMessageId) throw new Error("SMTP did not confirm a message identity.");
    const { error: saveError } = await db.from("mailbox_sent_messages").insert({ id: actionId, user_id: viewer.id, mailbox_id: mailbox.id,
      message_id: sent.messageId, from_email: mailbox.email, to_email: recipient, subject: email.subject, body: content.text, body_html: content.html || null,
      thread_key: threadKey, in_reply_to: email.inReplyTo ?? null, reference_ids: email.references ?? [], status: "sent", sent_at: new Date().toISOString(), attachments: stored });
    const { data: armed, error: armError } = await db.from("agent_reply_requests").update({ status: "waiting", message_id: actualMessageId, sent_record_id: saveError ? null : actionId,
      last_error: saveError ? "Email was accepted but its Sent copy could not be saved. Do not resend automatically." : null, updated_at: new Date().toISOString(),
    }).eq("id", actionId).eq("user_id", viewer.id).eq("status", "sending").select("id").maybeSingle();
    if (armError || !armed) throw new Error("The request email may have been sent, but waiting could not be confirmed. Check Sent before retrying.");
    return { success: `Request email accepted by the mailbox for ${recipient}. Waiting is saved; a matching human reply will create your review task.${saveError ? " The Sent copy could not be saved; do not resend." : ""}`, requestId: actionId, href: "/tasks" };
  } catch {
    await db.from("agent_reply_requests").update({ status: "uncertain", last_error: "Email delivery or waiting setup was not confirmed. Check Sent before sending again.", updated_at: new Date().toISOString() }).eq("id", actionId).eq("status", "sending");
    throw new Error("Email delivery or waiting setup was not confirmed. A saved request needs review under Tasks. Check Sent before sending again.");
  }
}
export async function cancelReplyRequest(viewer: WorkspaceViewer, id: string, revision?: number) {
  const row = await ownedReplyRequest(viewer, id, true);
  if (!active.includes(row.status)) throw new Error("This waiting request has already finished. Refresh its status.");
  if (revision !== undefined && revision !== row.revision) throw new Error("This waiting request changed. Refresh before stopping it.");
  const { data } = await createSupabaseAdmin().from("agent_reply_requests").update({ status: "cancelled", revision: row.revision + 1, updated_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", viewer.id).eq("revision", row.revision).in("status", active).select("id").maybeSingle().throwOnError();
  if (!data) throw new Error("This request changed while stopping. Refresh its current status.");
  return { success: "Waiting stopped. Messages and existing tasks were preserved.", href: "/tasks" };
}
