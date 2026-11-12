import "server-only";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { getViewerMailbox, mailboxHasImap, mailboxHasSmtp } from "./mailboxes";
import { getAssignedEmailContacts } from "./email-access";
import { canViewEmail } from "../email-access";
import { mailboxHistory } from "./email-auto-reply";
import { mergeAutoReplyHistory } from "../email-auto-reply";
import { getEmailInboxBackendData } from "../email-inbox";
import { loadSyncedMailbox } from "./mailbox-sync";
import { normalizeMessageId, referenceHeaderIds, threadKeyForEmail } from "../email-threading";
import { followupAnchors, followupConversation, followupChanged, followupMailboxFresh, followupMessageKey, followupSubject, followupInstruction, validateFollowupTime, type EmailFollowup, type FollowupSave } from "../email-followup";
import { requireAiFeature } from "./ai-settings";
import { aiBehaviorInstruction } from "../ai-policy";
import { resolveGatewayTokenAsync } from "../ai/provider-credentials";
import { generateGatewayText } from "../ai/gateway";
import { deliverEmail } from "./manual-email-send";

export type FollowupRow = EmailFollowup & {
  user_id: string; mailbox_id: string; message_key: string; message_id: string; thread_key: string;
  recipient: string; anchors: string[]; baseline: string[]; context_at: string; updated_at: string; delivery_id: string;
};
export function presentFollowup(row: FollowupRow | null): EmailFollowup | null {
  if (!row) return null;
  const { id, revision, kind, status, due_at, subject, body, error, task_id } = row;
  return { id, revision, kind, status, due_at, subject, body, error, task_id, purpose: row.purpose || "followup" };
}
async function authorizeMailbox(viewer: WorkspaceViewer, mailboxId: string, recipient?: string, requireReceiving = true) {
  const mailbox = await getViewerMailbox(viewer.id, mailboxId);
  if (!mailbox || (requireReceiving && !mailboxHasImap(mailbox))) throw new Error("This receiving mailbox is unavailable.");
  if (recipient && !canViewEmail(viewer, recipient, await getAssignedEmailContacts(viewer), mailbox)) throw new Error("This conversation is unavailable.");
  return mailbox;
}
export async function followupContext(viewer: WorkspaceViewer, mailboxId: string, messageId: string) {
  let { mailbox, messages } = await mailboxHistory(mailboxId, viewer.id, false, false);
  const matches = (message: (typeof messages)[number]) => message.id === messageId || Boolean(message.messageId && normalizeMessageId(message.messageId) === normalizeMessageId(messageId));
  if (!messages.some(matches)) ({ mailbox, messages } = await loadFollowupHistory(viewer, mailboxId, false, true));
  const message = messages.find(matches);
  if (!message) throw new Error("This message is unavailable in this mailbox.");
  const conversation = followupConversation(messages, [messageId]);
  const latest = conversation.at(-1);
  if (!latest) throw new Error("Choose an available email conversation.");
  const customerMessage = conversation.findLast(message => message.direction === "inbound") || latest;
  const recipient = (customerMessage.direction === "inbound" ? customerMessage.replyTo || customerMessage.contact : customerMessage.contact).trim().toLowerCase();
  await authorizeMailbox(viewer, mailboxId, recipient);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("This conversation has no valid reply address.");
  return { mailbox, message, conversation, latest, recipient, anchors: followupAnchors(conversation) };
}
async function loadFollowupHistory(viewer: WorkspaceViewer, mailboxId: string, includeContent = false, includeCrm = false) {
  const saved = await mailboxHistory(mailboxId, viewer.id, false, includeContent);
  if (!includeCrm) return saved;
  // Use the same authorized records displayed in this mailbox, including CRM and
  // store inquiries. Caller-provided bodies, recipients and thread IDs are ignored.
  const inbox = await getEmailInboxBackendData({ syncMailbox: false, mailboxId, context: { viewer, mailboxes: [saved.mailbox] } });
  const messages = inbox.emails.filter(message => message.direction === "inbound" || /^sent$/i.test(message.status));
  return { mailbox: saved.mailbox, messages: mergeAutoReplyHistory(messages, saved.messages) };
}
export async function readFollowup(viewer: WorkspaceViewer, mailboxId: string, messageId: string) {
  const context = await followupContext(viewer, mailboxId, messageId);
  const { data } = await createSupabaseAdmin().from("email_message_followups").select("*")
    .eq("user_id", viewer.id).eq("mailbox_id", mailboxId).overlaps("anchors", context.anchors)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle().throwOnError();
  return { context, row: data as FollowupRow | null };
}
export async function previewFollowup(viewer: WorkspaceViewer, mailboxId: string, messageId: string) {
  const context = await followupContext(viewer, mailboxId, messageId);
  const policy = await requireAiFeature("email", "emails");
  if (policy.actions.emailDrafts === "deny") throw new Error("AI email drafting is blocked in workspace settings.");
  const token = await resolveGatewayTokenAsync(process.env);
  if (!token) throw new Error("Configure an AI provider before generating a follow-up.");
  // Preview never opens competing IMAP sessions or waits for uncached old mail.
  // The reader's normal message load persists original bodies in this cache.
  const { messages } = await loadFollowupHistory(viewer, mailboxId, true, context.anchors.some(id => id.startsWith("local:")));
  const history = followupConversation(messages, context.anchors).slice(-12);
  const latest = history.at(-1);
  if (!latest || latest.bodyLoaded === false || !latest.body.trim()) throw new Error("Load the latest message in the mailbox before generating an AI follow-up. You can also write the follow-up manually.");
  const body = (await generateGatewayText({ token, task: "email", usageUserId: viewer.id,
    systemInstruction: followupInstruction + aiBehaviorInstruction(policy, true),
    prompt: JSON.stringify({ conversation: history.map(({ direction, subject, body, timestamp, bodyLoaded }) => ({ direction, subject, body: bodyLoaded === false ? "[Original email body is unavailable]" : body.slice(0, 6000), timestamp })) }),
    maxOutputTokens: 1600, signal: AbortSignal.timeout(55_000),
  })).trim();
  if (!body || body.length > 20000) throw new Error("AI could not prepare a follow-up. Review the conversation and write a message manually.");
  return { subject: followupSubject(latest.subject), body, baseline: context.conversation.map(followupMessageKey) };
}
export async function saveFollowup(viewer: WorkspaceViewer, input: FollowupSave, baseline: string[]) {
  validateFollowupTime(input.dueAt);
  const { context, row } = await readFollowup(viewer, input.mailboxId, input.messageId);
  if (row && (row.id !== input.id || row.revision !== input.revision)) throw new Error("Follow-up changed in another session. Reload before saving.");
  if (row?.status === "processing" || row?.status === "uncertain") throw new Error("Delivery may already be in progress. Check Sent before scheduling another follow-up.");
  if (context.conversation.some(message => !baseline.includes(followupMessageKey(message)))) throw new Error("The conversation changed while you reviewed the follow-up. Close this dialog and review the latest message before scheduling.");
  if (input.kind === "ai") {
    await checkFollowupPolicy();
    if (!mailboxHasSmtp(context.mailbox)) throw new Error("This mailbox needs an active SMTP connection for AI follow-ups.");
    if (/^(?:no-?reply|mailer-daemon|postmaster)@/i.test(context.recipient)) throw new Error("Automatic follow-ups cannot be sent to an unmonitored address.");
    await checkFollowupRecipient(context.recipient);
    const { data: active } = await createSupabaseAdmin().from("email_auto_replies").select("id")
      .eq("mailbox_id", input.mailboxId).eq("enabled", true).overlaps("anchors", context.anchors).limit(1).throwOnError();
    if (active?.length) throw new Error("Stop conversation AI auto-reply before scheduling a one-time AI follow-up.");
  }
  const patch = {
    mailbox_id: input.mailboxId, message_key: context.message.id, message_id: context.message.messageId || context.message.id,
    thread_key: row?.thread_key || threadKeyForEmail(context.conversation[0]), recipient: context.recipient,
    conversation_url: `/email?${new URLSearchParams({ mailbox: input.mailboxId, thread: row?.thread_key || threadKeyForEmail(context.conversation[0]) })}`,
    anchors: context.anchors, message_keys: context.conversation.map(message => message.id), baseline: context.conversation.map(followupMessageKey), context_at: context.latest.timestamp,
    kind: input.kind, purpose: input.purpose, due_at: input.dueAt, subject: input.subject, body: input.kind === "ai" ? input.body : "",
    ...(input.kind === "ai" ? { task_id: null } : {}),
    status: "scheduled", error: null, delivery_id: crypto.randomUUID(), revision: input.revision + 1, updated_at: new Date().toISOString(),
  };
  const db = createSupabaseAdmin();
  const result = row
    ? await db.from("email_message_followups").update(patch).eq("id", row.id).eq("user_id", viewer.id).eq("revision", input.revision).neq("status", "processing").select().maybeSingle()
    : await db.from("email_message_followups").insert({ ...patch, id: input.id, user_id: viewer.id }).select().single();
  if (result.error?.code === "23505") throw new Error("A follow-up is already scheduled for this conversation. Refresh or ask its owner to edit it.");
  if (result.error) throw result.error;
  if (!result.data) throw new Error("Follow-up changed. Reload before saving.");
  return result.data as FollowupRow;
}
export async function cancelFollowup(viewer: WorkspaceViewer, id: string, revision: number) {
  const db = createSupabaseAdmin();
  const { data: row } = await db.from("email_message_followups").select("*").eq("id", id).eq("user_id", viewer.id).single().throwOnError();
  await authorizeMailbox(viewer, row.mailbox_id, row.recipient);
  const { data } = await db.from("email_message_followups").update({ status: "cancelled", revision: revision + 1, error: "Cancelled by you.", updated_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", viewer.id).eq("revision", revision).in("status", ["scheduled", "reminded", "failed"]).select().maybeSingle().throwOnError();
  if (!data) throw new Error("The follow-up changed or delivery has started. Reload to see its status.");
  return data as FollowupRow;
}
async function checkFollowupRecipient(recipient: string) {
  const db = createSupabaseAdmin();
  const [suppression, contacts] = await Promise.all([
    db.from("suppression").select("email").eq("email", recipient).limit(1).throwOnError(),
    db.from("contacts").select("unsubscribed").eq("email", recipient).throwOnError(),
  ]);
  if (suppression.data?.length || contacts.data?.some(contact => contact.unsubscribed)) throw new Error("This customer has opted out or is suppressed. No automated follow-up can be sent.");
}
async function checkFollowupPolicy() {
  const policy = await requireAiFeature("email", "emails");
  // The user reviews this exact message and confirms its one-time delivery.
  // Workspace-level denial still takes precedence, including after scheduling.
  if (policy.actions.sending === "deny") throw new Error("AI message sending is blocked in workspace settings.");
}
/** Runs from the existing minute scheduler; claims and delivery IDs prevent duplicate sends. */
export async function processEmailFollowups(options: { deadline?: number } = {}) {
  const db = createSupabaseAdmin();
  // Never retry a process interrupted around SMTP; reconcile a recorded success only.
  const { data: interrupted } = await db.from("email_message_followups").select("*").eq("status", "processing")
    .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString()).limit(20).throwOnError();
  for (const row of (interrupted || []) as FollowupRow[]) {
    const { data: operation } = await db.from("email_send_operations").select("status").eq("id", row.delivery_id).eq("user_id", row.user_id).maybeSingle().throwOnError();
    await db.from("email_message_followups").update({ status: operation?.status === "sent" ? "sent" : "uncertain", error: operation?.status === "sent" ? null : "Delivery was interrupted. Check Sent before scheduling again.", updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("status", "processing").eq("revision", row.revision).throwOnError();
  }
  const { data } = await db.from("email_message_followups").select("*").eq("status", "scheduled").order("due_at").limit(100).throwOnError();
  const snapshots = new Map<string, ReturnType<typeof loadSyncedMailbox>>();
  const conversations = new Map<string, ReturnType<typeof mailboxHistory>>();
  let processed = 0;
  for (const row of (data || []) as FollowupRow[]) {
    if (options.deadline && Date.now() > options.deadline - 120_000) break;
    try {
      const { data: member } = await db.from("workspace_members").select("role,display_name,activated_at").eq("user_id", row.user_id).maybeSingle().throwOnError();
      if (!member?.activated_at || !["admin", "operator", "bd_manager"].includes(member.role)) throw new Error("The follow-up owner can no longer send or manage email.");
      const viewer = { id: row.user_id, role: member.role, displayName: member.display_name, email: null } as WorkspaceViewer;
      const mailbox = await authorizeMailbox(viewer, row.mailbox_id, row.recipient, row.kind === "ai");
      const account = `${row.user_id}:${row.mailbox_id}`;
      if (!snapshots.has(account)) snapshots.set(account, loadSyncedMailbox(mailbox, { sync: false, includeContent: false }));
      const snapshot = await snapshots.get(account)!;
      const conversationAccount = `${account}:${row.anchors.some(id => id.startsWith("local:"))}`;
      if (mailboxHasImap(mailbox) && !conversations.has(conversationAccount)) conversations.set(conversationAccount, loadFollowupHistory(viewer, row.mailbox_id, false, row.anchors.some(id => id.startsWith("local:"))));
      const messages = conversations.has(conversationAccount) ? (await conversations.get(conversationAccount)!).messages : snapshot.messages;
      const history = followupConversation(messages, row.anchors);
      if (followupChanged(history, row.baseline, row.context_at)) {
        await db.from("email_message_followups").update({ status: "cancelled", error: "Conversation received a reply or a newer sent message.", revision: row.revision + 1, updated_at: new Date().toISOString() }).eq("id", row.id).eq("revision", row.revision).eq("status", "scheduled").throwOnError();
        continue;
      }
      if (Date.parse(row.due_at) > Date.now()) continue;
      if (row.kind === "reminder") {
        await db.from("email_message_followups").update({ status: "reminded", revision: row.revision + 1, updated_at: new Date().toISOString() }).eq("id", row.id).eq("revision", row.revision).eq("status", "scheduled").throwOnError();
        processed++; continue;
      }
      if (!followupMailboxFresh(snapshot)) {
        await db.from("email_message_followups").update({ error: "Waiting for a fresh mailbox sync to check for customer replies." }).eq("id", row.id).eq("status", "scheduled").eq("revision", row.revision).throwOnError();
        continue;
      }
      if (!history.length) throw new Error("This conversation is no longer available in the synced mailbox. Review it before rescheduling.");
      await checkFollowupRecipient(row.recipient);
      await checkFollowupPolicy();
      const { data: claimed } = await db.from("email_message_followups").update({ status: "processing", revision: row.revision + 1, error: null, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("revision", row.revision).eq("status", "scheduled").select("id").maybeSingle().throwOnError();
      if (!claimed) continue;
      const response = await deliverEmail(viewer, {
        mailboxId: row.mailbox_id, to: [row.recipient], subject: row.subject, text: row.body,
        requestId: row.delivery_id, threadId: row.thread_key, inReplyTo: referenceHeaderIds(row.message_id)[0], references: referenceHeaderIds(row.anchors),
      }, false, async () => {
        await authorizeMailbox(viewer, row.mailbox_id, row.recipient);
        await checkFollowupRecipient(row.recipient);
        await checkFollowupPolicy();
        const { data: active } = await db.from("email_auto_replies").select("id").eq("mailbox_id", row.mailbox_id).eq("enabled", true).overlaps("anchors", row.anchors).limit(1).throwOnError();
        if (active?.length) throw new Error("Conversation AI auto-reply is active. Review it before rescheduling this follow-up.");
        const latest = await loadFollowupHistory(viewer, row.mailbox_id, false, row.anchors.some(id => id.startsWith("local:")));
        if (followupChanged(followupConversation(latest.messages, row.anchors), row.baseline, row.context_at)) throw new Error("Conversation changed before delivery. The follow-up was stopped.");
        const fresh = await loadSyncedMailbox(mailbox, { sync: false, includeContent: false });
        if (!followupMailboxFresh(fresh)) throw new Error("Mailbox sync is stale. Review the conversation before rescheduling.");
      });
      const result = await response.json();
      const { data: operation } = await db.from("email_send_operations").select("status").eq("id", row.delivery_id).eq("user_id", row.user_id).maybeSingle().throwOnError();
      const status = result.ok && operation?.status === "sent" ? "sent" : operation?.status === "uncertain" || ["submitting", "preparing"].includes(operation?.status || "") ? "uncertain" : "failed";
      await db.from("email_message_followups").update({ status, error: status === "sent" ? null : result.error || "Follow-up delivery needs review.", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "processing").eq("revision", row.revision + 1).throwOnError();
      processed++;
    } catch (error) {
      await db.from("email_message_followups").update({ status: "failed", error: error instanceof Error ? error.message : "Unable to process follow-up.", updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("revision", row.revision).eq("status", "scheduled").throwOnError();
    }
  }
  return processed;
}
