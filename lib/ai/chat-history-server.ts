import "server-only";
import { createHash } from "node:crypto";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { getCompanyDetails } from "../data/crm";
import { getInvoice } from "../data/invoices";
import { getViewerMailboxes } from "../data/mailboxes";
import { getAssignedEmailContacts } from "../data/email-access";
import { loadAgentEmails } from "./agent-records";
import { loadAgentConversation, loadAgentFlow } from "./agent-page-records";
import { conversationMemory, conversationScope, type ConversationInput, type HistoryReference, type HistoryMessage } from "./chat-history";
import type { AiUsage } from "./chat-usage";
import type { AgentActionResult } from "./agent-actions";

export class HistoryError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export type ConversationRow = {
  id: string; user_id: string; owner_role: string; access_key: string; mode: ConversationInput["mode"]; pathname: string;
  page_context: NonNullable<ConversationInput["pageContext"]>; scope: string; title: string;
  pinned: boolean; archived: boolean; version: number; summary: string; updated_at: string; active_request: string | null;
};
export const presentConversation = (row: ConversationRow) => ({ id: row.id, mode: row.mode, pathname: row.pathname, pageContext: row.page_context, title: row.title, pinned: row.pinned, archived: row.archived, version: row.version, summary: row.summary, updated_at: row.updated_at, pending: Boolean(row.active_request) });

// Histories can include emails discovered by an agent away from an open record.
// Changed mailbox grants or sales assignments invalidate the whole transcript.
export async function conversationAccessKey(viewer: WorkspaceViewer) {
  const [mailboxes, assigned] = await Promise.all([getViewerMailboxes(viewer.id), getAssignedEmailContacts(viewer)]);
  const mailboxScope = mailboxes.map((m) => ({ id: m.id, type: m.type, userId: m.userId, isActive: m.isActive, email: m.email })).sort((a, b) => a.id.localeCompare(b.id));
  const assignments = [...(assigned?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify([viewer.id, viewer.role, mailboxScope, assignments])).digest("hex");
}

export async function assertConversationAccess(input: ConversationInput, viewer: WorkspaceViewer) {
  const context = input.pageContext ?? {};
  const companyId = context.companyId || /^\/companies\/([a-f0-9-]{36})(?:\/|$)/i.exec(input.pathname)?.[1];
  const invoiceId = context.invoiceId || /^\/invoices\/([a-f0-9-]{36})(?:\/|$)/i.exec(input.pathname)?.[1];
  if (input.mode === "customer" && (!companyId || input.pathname !== `/companies/${companyId}`)) throw new HistoryError("Choose a customer for this conversation.", 400);
  if (companyId && !(await getCompanyDetails(companyId)).details) throw new HistoryError("This customer is no longer available.", 404);
  if (invoiceId && !(await getInvoice(invoiceId))) throw new HistoryError("This invoice is no longer available.", 404);
  if (context.emailId) await loadAgentEmails(viewer, context.emailId, undefined, context.mailboxId);
  if (context.conversationId) await loadAgentConversation(context.conversationId);
  if (context.flowId) await loadAgentFlow(context.flowId);
}

export async function ownedConversation(id: string, viewer: WorkspaceViewer) {
  const accessKey = await conversationAccessKey(viewer);
  const { data, error } = await createSupabaseAdmin().from("ai_conversations").select("*").eq("id", id).eq("user_id", viewer.id).eq("owner_role", viewer.role).eq("access_key", accessKey).maybeSingle();
  if (error) throw new HistoryError("Unable to load saved conversations. Check the AI history migration.", 503);
  if (!data) throw new HistoryError("Conversation unavailable for your current account and role.", 404);
  const row = data as ConversationRow;
  await assertConversationAccess({ mode: row.mode, pathname: row.pathname, pageContext: row.page_context }, viewer);
  return row;
}

type MessageRow = { id: string; turn: number; role: "user" | "assistant"; content: string; metadata: Record<string, unknown> };
export async function conversationMessages(id: string, limit = 40, before?: number) {
  let query = createSupabaseAdmin().from("ai_chat_messages").select("id,turn,role,content,metadata").eq("conversation_id", id).order("turn", { ascending: false }).order("role", { ascending: true }).limit(limit + 2);
  if (before !== undefined) query = query.lt("turn", before);
  const { data, error } = await query;
  if (error) throw new HistoryError("Unable to read saved messages.", 503);
  const rows = (data ?? []) as MessageRow[];
  const visible = rows.slice(0, limit).reverse();
  const messages = visible.map(({ id: messageId, role, content, metadata }) => ({ ...metadata, id: messageId, role, content })) as HistoryMessage[];
  return { messages, hasMore: rows.length > limit, before: visible[0]?.turn };
}

export async function conversationActions(id: string, viewer: WorkspaceViewer, messageIds?: string[]) {
  // Fetch only actions displayed on this transcript page. Results never come from
  // client state and reopening history cannot approve or execute an old proposal.
  const db = createSupabaseAdmin();
  let query = db.from("workspace_agent_actions").select("id,status,result,expires_at,approval,finished_at").eq("conversation_id", id).eq("user_id", viewer.id);
  if (messageIds) { if (!messageIds.length) return {}; query = query.in("id", messageIds); }
  const { data, error } = await query.limit(400);
  if (error) throw new HistoryError("Unable to read saved action results.", 503);
  return Object.fromEntries((data ?? []).filter((row) => row.status !== "pending" || Date.parse(row.expires_at) <= Date.now()).map((row) => [row.id, {
    ...row.result, status: row.status === "pending" ? "expired" : row.status, approval: row.approval, finishedAt: row.finished_at,
    ...(row.status === "declined" ? { success: "Action declined. Nothing was changed." } : {}),
    ...(row.status === "pending" ? { error: "This proposal expired. Ask the agent to prepare it again." } : {}),
  }])) as Record<string, AgentActionResult>;
}

export async function beginSavedTurn(reference: HistoryReference, input: ConversationInput, viewer: WorkspaceViewer) {
  const row = await ownedConversation(reference.conversationId, viewer);
  if (row.scope !== conversationScope(input)) throw new HistoryError("This history belongs to another page, record or AI mode. Open its original page to continue.");
  const db = createSupabaseAdmin();
  const { data, error } = await db.rpc("begin_ai_chat_turn", { p_user_id: viewer.id, p_conversation_id: row.id, p_request_id: reference.requestId, p_version: reference.version });
  if (error) throw new HistoryError(error.code === "P0001" ? error.message : "Unable to start a saved conversation.");
  if (data?.response) return { row, replay: data.response, messages: [] as HistoryMessage[], completedActionIds: [] as string[] };
  try {
    const { messages } = await conversationMessages(row.id, 10);
    const { data: actions, error: actionError } = await db.from("workspace_agent_actions").select("id,status,action,expires_at").eq("user_id", viewer.id).eq("conversation_id", row.id).in("status", ["pending", "completed", "failed", "running"]).order("created_at", { ascending: false }).limit(20);
    if (actionError) throw new Error("Unable to load saved agent results.");
    return { row, replay: undefined, messages, completedActionIds: (actions ?? []).filter((a) => a.status !== "pending").map((a) => a.id as string), pendingInvoices: (actions ?? []).filter((a) => a.status === "pending" && Date.parse(a.expires_at) > Date.now()).slice(0, 5) };
  } catch (error) { await failSavedTurn(reference, viewer); throw error; }
}

export async function finishSavedTurn(reference: HistoryReference, viewer: WorkspaceViewer, prior: Awaited<ReturnType<typeof beginSavedTurn>>, userMessage: { content: string; images?: { name: string }[] }, response: { output: string; [key: string]: unknown }) {
  const summary = conversationMemory([...prior.messages, { role: "user", content: userMessage.content }, { role: "assistant", content: response.output }], prior.row.summary).summary;
  const saved = { ...response, history: { conversationId: reference.conversationId, version: prior.row.version + 1, summary, title: prior.row.version === 0 && prior.row.title === "New conversation" ? (userMessage.content.trim() || "Image conversation").slice(0, 120) : prior.row.title } };
  const args = { p_user_id: viewer.id, p_conversation_id: reference.conversationId, p_request_id: reference.requestId, p_user_message: { content: userMessage.content, attachmentNames: userMessage.images?.map((i) => i.name) ?? [] }, p_response: saved, p_summary: summary };
  // Completion is idempotent. One retry handles a lost response after commit.
  let result = await createSupabaseAdmin().rpc("finish_ai_chat_turn", args);
  if (result.error) result = await createSupabaseAdmin().rpc("finish_ai_chat_turn", args);
  if (result.error) throw new HistoryError("The reply could not be saved. Reload history before retrying; agent actions may already be prepared.", 503);
  return saved;
}

export async function failSavedTurn(reference: HistoryReference, viewer: WorkspaceViewer) {
  const { error } = await createSupabaseAdmin().rpc("fail_ai_chat_turn", { p_user_id: viewer.id, p_conversation_id: reference.conversationId, p_request_id: reference.requestId });
  if (error) console.error("Unable to release saved conversation", error.code);
}

export async function saveChatUsage(reference: HistoryReference, viewer: WorkspaceViewer, usage: AiUsage[]) {
  if (!usage.length) return;
  const { error } = await createSupabaseAdmin().from("ai_usage_events").upsert(usage.map((call, index) => ({ user_id: viewer.id, conversation_id: reference.conversationId, request_id: reference.requestId, call_index: index, provider: call.provider, model: call.model, input_tokens: call.inputTokens, output_tokens: call.outputTokens, total_tokens: call.totalTokens, estimated_cost_usd: call.estimatedCostUsd, success: call.success })), { onConflict: "request_id,call_index", ignoreDuplicates: true });
  if (error) console.error("Unable to save AI usage", error.code);
}
