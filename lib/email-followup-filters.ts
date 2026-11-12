import { normalizeMessageId, replyReferences, threadKeyForEmail, type EmailThreadMetadata } from "./email-threading.ts";
import type { EmailFollowup } from "./email-followup.ts";

export type FollowupFilter = "all" | "ai" | "manual" | "completed" | "nurture";
export type FollowupActionRecord = {
  id: string; source: "followup" | "auto-reply"; kind: "ai" | "reminder"; status: string;
  enabled?: boolean; messageKey?: string; threadKey: string; anchors: string[]; updatedAt: string;
  taskStatus?: string | null;
  purpose?: "followup" | "nurture"; dueAt?: string;
};
export type FollowupActionIndex = Map<string, FollowupActionRecord[]>;
const identity = (value: string) => normalizeMessageId(value) || value;
export function indexFollowupActions(records: FollowupActionRecord[]): FollowupActionIndex {
  const index: FollowupActionIndex = new Map();
  for (const record of records) {
    if (record.source !== "followup") continue;
    const keys = new Set([...(record.messageKey ? [record.messageKey, `local:${record.messageKey}`] : []), `thread:${record.threadKey}`, ...record.anchors].map(identity));
    for (const key of keys) index.set(key, [...index.get(key) || [], record]);
  }
  return index;
}
export function conversationFollowupActions(messages: EmailThreadMetadata[], index: FollowupActionIndex): FollowupActionRecord[] {
  const matches = new Map<string, FollowupActionRecord>();
  for (const message of messages) {
    for (const key of [message.id, `local:${message.id}`, `thread:${threadKeyForEmail(message)}`, ...replyReferences(message)].map(identity)) {
      for (const action of index.get(key) || []) matches.set(`${action.source}:${action.id}`, action);
    }
  }
  return [...matches.values()];
}
export function followupActionState(action: FollowupActionRecord): Exclude<FollowupFilter, "all"> {
  const complete = ["sent", "cancelled"].includes(action.status) || ["done", "cancelled"].includes(action.taskStatus || "");
  if (complete) return "completed";
  if (action.kind === "reminder" || ["failed", "uncertain", "needs_review", "waiting_shipping"].includes(action.status)) return "manual";
  return action.purpose === "nurture" ? "nurture" : "ai";
}
/** Only actions saved through the follow-up panel enroll a conversation. */
export function followupConversationFilters(messages: EmailThreadMetadata[], index: FollowupActionIndex): Set<Exclude<FollowupFilter, "all">> {
  const matches = conversationFollowupActions(messages, index);
  const result = new Set<Exclude<FollowupFilter, "all">>();
  let ended = false;
  for (const action of matches) {
    const state = followupActionState(action);
    if (state === "completed") { ended = true; continue; }
    result.add(state);
  }
  if (!result.size && ended) result.add("completed");
  return result;
}
export function followupView<T extends { id: string }>(conversations: T[], groups: Map<string, Set<Exclude<FollowupFilter, "all">>>, filter: FollowupFilter) {
  const enrolled = conversations.filter(item => Boolean(groups.get(item.id)?.size));
  const counts: Record<FollowupFilter, number> = { all: enrolled.length, ai: 0, manual: 0, completed: 0, nurture: 0 };
  for (const item of enrolled) for (const state of groups.get(item.id) || []) counts[state]++;
  return { counts, conversations: filter === "all" ? enrolled : enrolled.filter(item => groups.get(item.id)?.has(filter)) };
}

/** Apply a confirmed panel change before the next status-list refresh finishes. */
export function updateFollowupActions(records: FollowupActionRecord[], followup: EmailFollowup, messages: EmailThreadMetadata[]): FollowupActionRecord[] {
  if (!messages.length) return records;
  const previous = records.find(record => record.source === "followup" && record.id === followup.id);
  const action: FollowupActionRecord = {
    id: followup.id, source: "followup", kind: followup.kind, purpose: followup.purpose || "followup", status: followup.status,
    messageKey: previous?.messageKey || messages[0].id, threadKey: previous?.threadKey || threadKeyForEmail(messages[0]),
    anchors: [...new Set([...(previous?.anchors || []), ...messages.flatMap(message => [
      `local:${message.id}`, `thread:${threadKeyForEmail(message)}`, ...replyReferences(message),
    ])])],
    dueAt: followup.due_at, updatedAt: new Date().toISOString(), taskStatus: null,
  };
  return [...records.filter(record => record.source !== "followup" || record.id !== followup.id), action];
}
