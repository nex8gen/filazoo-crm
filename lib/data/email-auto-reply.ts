import "server-only";
import { requireAiAutomation } from "./ai-settings";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { getViewerMailbox, mailboxHasImap, mailboxHasSmtp } from "./mailboxes";
import { loadSyncedMailbox, loadMailboxMessageContent } from "./mailbox-sync";
import { getAssignedEmailContacts } from "./email-access";
import { canViewEmail } from "../email-access";
import { autoReplyConversation, latestCustomerMessage, mergeAutoReplyHistory, messageIdentity, isAutoReplySchemaMissing, type AutoReplyState } from "../email-auto-reply";
import { normalizeMessageId, replyReferences, threadKeyForEmail } from "../email-threading";
import type { InboxEmailItem } from "../email-inbox";
import { hasFlowReplyProvider } from "./flow-ai-reply";

export type AutoReplyRow = AutoReplyState & {
  user_id: string; sender_id: string; anchors: string[]; history: InboxEmailItem[];
  last_message_key: string; enabled_at: string; pending_message_key: string | null;
  processing_at: string | null; updated_at: string;
};
type SavedSentRow = {
  id: string; from_email: string; to_email: string; subject: string; body?: string; sent_at: string;
  message_id: string | null; thread_key: string | null; in_reply_to: string | null;
  reference_ids?: string[]; attachments?: InboxEmailItem["attachments"];
};

export function presentAutoReply(row: AutoReplyRow | null): AutoReplyState | null {
  if (!row) return null;
  const { id, enabled, status, revision, recipient, mailbox_id, thread_key, assigned_to, last_error, last_sent_at, invoice_id, task_id, pending_document } = row;
  return { id, enabled, status, revision, recipient, mailbox_id, thread_key, assigned_to, last_error, last_sent_at, invoice_id, task_id, pending_document };
}

export async function authorizeAutoReply(viewer: WorkspaceViewer, row: AutoReplyRow) {
  const mailbox = await getViewerMailbox(viewer.id, row.mailbox_id);
  const assigned = await getAssignedEmailContacts(viewer);
  if (!mailbox || !canViewEmail(viewer, row.recipient, assigned, mailbox)) throw new Error("This conversation is unavailable.");
  // Shared conversations may be managed by their responsible user or workspace operators.
  if (viewer.role === "viewer" || (viewer.role === "bd_manager" && viewer.id !== row.user_id && viewer.id !== row.assigned_to))
    throw new Error("Only the responsible user or a workspace operator can manage this automation.");
  return mailbox;
}

export async function getAutoReply(viewer: WorkspaceViewer, id: string) {
  const { data } = await createSupabaseAdmin().from("email_auto_replies").select("*").eq("id", id).maybeSingle().throwOnError();
  if (!data) throw new Error("Conversation automation not found.");
  const row = data as AutoReplyRow;
  await authorizeAutoReply(viewer, row);
  return row;
}

/** Reading a setting must never sync a provider or reload conversation bodies. */
export async function readAutoReplySetting(viewer: WorkspaceViewer, mailboxId: string, messageIds: string[]) {
  const mailbox = await getViewerMailbox(viewer.id, mailboxId);
  if (!mailbox) throw new Error("This mailbox is unavailable.");
  const anchors = [...new Set(messageIds.map(normalizeMessageId).filter((id): id is string => Boolean(id)))];
  const { data } = await createSupabaseAdmin().from("email_auto_replies")
    .select("id,enabled,status,revision,recipient,mailbox_id,thread_key,assigned_to,last_error,last_sent_at,invoice_id,task_id,pending_document,user_id")
    .eq("mailbox_id", mailboxId)
    .overlaps("anchors", anchors).limit(1).maybeSingle().throwOnError();
  if (data) await authorizeAutoReply(viewer, data as AutoReplyRow);
  return data as AutoReplyRow | null;
}

export async function mailboxHistory(mailboxId: string, userId: string, sync = false, includeContent = true) {
  const mailbox = await getViewerMailbox(userId, mailboxId);
  if (!mailbox || !mailboxHasImap(mailbox)) throw new Error("The receiving mailbox is stopped or unavailable.");
  const snapshot = await loadSyncedMailbox(mailbox, { sync: false, includeContent });
  if (snapshot.error && sync) throw new Error(snapshot.error);
  const columns = includeContent ? "*" : "id,from_email,to_email,subject,sent_at,message_id,thread_key,in_reply_to,reference_ids";
  const { data } = await createSupabaseAdmin().from("mailbox_sent_messages").select(columns)
    .eq("mailbox_id", mailboxId).eq("status", "sent").order("sent_at", { ascending: false }).limit(1000).throwOnError();
  const sent: InboxEmailItem[] = ((data ?? []) as unknown as SavedSentRow[]).map((message) => ({
    id: `sent-${message.id}`, direction: "outbound", from: message.from_email, contact: message.to_email,
    subject: message.subject, body: message.body || "", bodyLoaded: true, company: "", preview: "", status: "Sent",
    timestamp: message.sent_at, messageId: message.message_id, threadId: message.thread_key,
    inReplyTo: message.in_reply_to, references: message.reference_ids ?? [],
    attachments: message.attachments ?? [],
  }));
  return { mailbox, messages: mergeAutoReplyHistory([], [...snapshot.messages, ...sent]) };
}

export async function hydrateAutoReplyHistory(mailbox: NonNullable<Awaited<ReturnType<typeof getViewerMailbox>>>, messages: InboxEmailItem[]) {
  const result: InboxEmailItem[] = [];
  for (const message of messages) {
    if (message.bodyLoaded !== false) { result.push(message); continue; }
    if (!message.uid || !message.uidValidity) throw new Error("The complete conversation is unavailable. Load its history before enabling AI.");
    result.push({ ...message, ...await loadMailboxMessageContent(mailbox, message.uid, message.uidValidity) });
  }
  return result;
}

export async function findAutoReply(viewer: WorkspaceViewer, mailboxId: string, messageId: string) {
  const { mailbox, messages } = await mailboxHistory(mailboxId, viewer.id, false, false);
  const message = messages.find((item) => normalizeMessageId(item.messageId) === normalizeMessageId(messageId));
  if (!message || !canViewEmail(viewer, message.contact, await getAssignedEmailContacts(viewer), mailbox))
    throw new Error("This email is unavailable.");
  const conversation = autoReplyConversation(messages, [messageId]);
  const anchors = [...new Set(conversation.flatMap((item) => replyReferences(item)).map((id) => normalizeMessageId(id)!))];
  const { data } = await createSupabaseAdmin().from("email_auto_replies").select("*").eq("mailbox_id", mailboxId)
    .overlaps("anchors", anchors).limit(1).maybeSingle().throwOnError();
  if (data) await authorizeAutoReply(viewer, data as AutoReplyRow);
  return { row: data as AutoReplyRow | null, mailbox, conversation, anchors };
}

export async function enableAutoReply(viewer: WorkspaceViewer, input: { mailboxId: string; senderId: string; messageId: string; revision: number }) {
  await requireAiAutomation(["sending"], ["emails", "customers", "products", "billing", "knowledge", "team", "settings"]);
  if (!hasFlowReplyProvider()) throw new Error("Configure an AI provider before enabling automatic replies.");
  const found = await findAutoReply(viewer, input.mailboxId, input.messageId);
  if (input.senderId !== input.mailboxId) throw new Error("Automatic replies must use this conversation's receiving mailbox so future replies stay connected.");
  if ((found.row?.revision ?? 0) !== input.revision) throw new Error("Automation changed. Refresh before enabling it.");
  if (!mailboxHasSmtp(await getViewerMailbox(viewer.id, input.senderId))) throw new Error("Select an active sender with SMTP configured.");
  // Opt in using saved headers immediately. Original bodies are loaded by the
  // worker only when a future reply needs processing, never by the toggle.
  const history = found.conversation;
  const latest = [...history].reverse().find((message) => message.direction === "inbound");
  if (!latest?.messageId) throw new Error("Enable AI on a conversation with a received customer email.");
  const recipient = (latest.replyTo || latest.contact).trim().toLowerCase();
  if (!canViewEmail(viewer, recipient, await getAssignedEmailContacts(viewer), found.mailbox)) throw new Error("Customer assignment does not allow this recipient.");
  const db = createSupabaseAdmin();
  const { data: contacts } = await db.from("contacts").select("id,company_id").eq("email", recipient).limit(2).throwOnError();
  const contact = contacts?.length === 1 ? contacts[0] : null;
  const { data: pipeline } = contact ? await db.from("pipeline").select("owner_id").eq("company_id", contact.company_id).maybeSingle().throwOnError() : { data: null };
  // A personal mailbox never grants another teammate access to its conversation.
  const assignedTo = found.mailbox.type === "personal" ? viewer.id : pipeline?.owner_id || viewer.id;
  const { data: assignee } = await db.from("workspace_members").select("role").eq("user_id", assignedTo).not("activated_at", "is", null).maybeSingle().throwOnError();
  if (!assignee || assignee.role === "viewer") throw new Error("Assign this customer to an active sales user before enabling AI.");
  const patch = {
    user_id: viewer.id, sender_id: input.senderId, recipient, assigned_to: assignedTo,
    enabled: true, status: "active", history: mergeAutoReplyHistory(found.row?.history ?? [], history),
    anchors: found.anchors, thread_key: threadKeyForEmail(history[0]), last_message_key: messageIdentity(latest),
    enabled_at: new Date().toISOString(), pending_document: null, pending_message_key: null, task_id: null,
    invoice_id: null, processing_at: null, last_error: null, revision: input.revision + 1,
  };
  if (found.row?.status === "processing") throw new Error("AI is processing a reply. Stop it before enabling again.");
  const result = found.row
    ? await db.from("email_auto_replies").update(patch).eq("id", found.row.id).eq("revision", input.revision).select().maybeSingle().throwOnError()
    : await db.from("email_auto_replies").insert({ ...patch, mailbox_id: input.mailboxId, root_message_id: found.anchors[0] }).select().single().throwOnError();
  if (!result.data) throw new Error("Automation changed. Refresh and try again.");
  if (found.row?.task_id) await db.from("crm_tasks").update({ status: "cancelled" }).eq("id", found.row.task_id).eq("status", "open").throwOnError();
  return result.data as AutoReplyRow;
}

export async function stopAutoReply(viewer: WorkspaceViewer, id: string) {
  const db = createSupabaseAdmin();
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await getAutoReply(viewer, id);
    if (!row.enabled && row.status === "paused") return row;
    const { data } = await db.from("email_auto_replies").update({ enabled: false, status: "paused", revision: row.revision + 1, processing_at: null })
      .eq("id", id).eq("revision", row.revision).select().maybeSingle().throwOnError();
    // A background claim can advance the revision while Stop is saving.
    // Re-read and retry so taking over manually does not require another click.
    if (!data) continue;
    if (row.task_id) await db.from("crm_tasks").update({ status: "cancelled" }).eq("id", row.task_id).eq("status", "open").throwOnError();
    return data as AutoReplyRow;
  }
  throw new Error("Unable to stop auto-reply. Please try again.");
}

/** A manual reply takes over any authorized automation linked to its RFC chain. */
export async function stopAutoReplyForManualSend(viewer: WorkspaceViewer, messageIds: string[], recipient: string) {
  const anchors = messageIds.map(normalizeMessageId).filter((id): id is string => Boolean(id));
  if (!anchors.length) return;
  const { data, error } = await createSupabaseAdmin().from("email_auto_replies").select("*").eq("enabled", true).eq("recipient", recipient.toLowerCase());
  if (isAutoReplySchemaMissing(error)) return;
  if (error) throw error;
  for (const candidate of data ?? []) {
    const row = candidate as AutoReplyRow;
    // An unrelated personal mailbox with an identical Message-ID is not ours.
    const mailbox = await getViewerMailbox(viewer.id, row.mailbox_id);
    if (!mailbox) continue;
    const { messages } = await mailboxHistory(row.mailbox_id, viewer.id);
    const linked = autoReplyConversation(mergeAutoReplyHistory(row.history, messages), row.anchors);
    if (!linked.some((message) => [normalizeMessageId(message.messageId), ...replyReferences(message).map(normalizeMessageId)]
      .some((key) => key && anchors.includes(key)))) continue;
    await authorizeAutoReply(viewer, row);
    await stopAutoReply(viewer, row.id);
  }
}

export async function approveAutoReplyShipping(viewer: WorkspaceViewer, id: string, revision: number, shippingMinor: number) {
  await requireAiAutomation(["sending", "invoices", "destructive"], ["emails", "customers", "billing", "products"]);
  const row = await getAutoReply(viewer, id);
  if (viewer.id !== row.assigned_to && !["admin", "operator"].includes(viewer.role)) throw new Error("Only the assigned user can approve shipping.");
  if (!row.enabled || row.status !== "waiting_shipping" || row.revision !== revision || !row.pending_document)
    throw new Error("This shipping request changed. Refresh before approving it.");
  const { mailbox, messages } = await mailboxHistory(row.mailbox_id, row.user_id, true);
  const conversation = autoReplyConversation(mergeAutoReplyHistory(row.history, messages), row.anchors);
  const latest = latestCustomerMessage(conversation, row.recipient);
  if (!latest || messageIdentity(latest) !== row.pending_message_key) throw new Error("The customer sent a new message. Review the conversation before approving shipping.");
  if (!mailboxHasImap(mailbox)) throw new Error("Receiving mailbox unavailable.");
  const { data } = await createSupabaseAdmin().from("email_auto_replies").update({
    pending_document: { ...row.pending_document, shippingMinor }, status: "ready", revision: revision + 1,
  }).eq("id", id).eq("revision", revision).eq("status", "waiting_shipping").eq("enabled", true).select().maybeSingle().throwOnError();
  if (!data) throw new Error("This shipping request changed. Refresh before approving it.");
  return data as AutoReplyRow;
}
