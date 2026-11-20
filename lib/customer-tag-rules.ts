import { normalizeCustomerTag, uniqueCustomerTags, type CustomerTag } from "./customer-tags.ts";

/** Commercial facts are owned by the ledger, never inferred from email prose. */
export const commercialCustomerTags = ["Payment Follow-up", "Orders in Fulfillment", "Repeat Customers"] as const;
export const communicationCustomerTags = ["Contacted — waiting for customer", "Customer replied"] as const;
export type TagProcessingStatus = "current" | "pending" | "waiting_history" | "needs_review" | "retrying" | "paused";
export type CustomerTagRuleState = {
  tags: string[];
  communication: Array<{ keys: string[]; status: "new" | "contacted" | "replied" }>;
  processing_status: TagProcessingStatus;
  processing_reason: string | null;
  facts?: Record<string, unknown>;
};
export type CustomerTagAssignment = { tag: string | null; source?: string; message_key?: string };

/** A company's current view retains human decisions and distinct opportunities. */
export function projectCustomerTags(assignments: readonly CustomerTagAssignment[], state?: CustomerTagRuleState | null): CustomerTag[] {
  if (!state || state.facts && state.facts.version !== "rules-v1") return uniqueCustomerTags(assignments.map(row => row.tag));
  const progressed = new Set(state.communication.filter(item => item.status !== "new").flatMap(item => item.keys));
  const tags = assignments.flatMap(row => {
    const tag = normalizeCustomerTag(row.tag);
    if (!tag) return [];
    // A manual removal/override is not rewritten by a company-wide rollup.
    if (row.source === "manual" || row.source === "flow") return [tag];
    if (commercialCustomerTags.some(value => value === tag)) return [];
    if (communicationCustomerTags.some(value => value === tag)) return [];
    if (tag === "New Inquiries" && row.message_key && progressed.has(row.message_key)) return [];
    return [tag];
  });
  return uniqueCustomerTags([...tags, ...state.tags]);
}

export function ruleOnlyConversation(input: {
  messages: readonly { direction: string; automaticResponse?: boolean; messageId?: string | null; id: string; source?: string }[];
  automaticMessageIds: ReadonlySet<string>;
}): boolean {
  const messages = input.messages.filter(message => !message.automaticResponse);
  // Intake plus recorded workflow sends has known communication effects. Human
  // prose, customer replies and external quotes still need interpretation.
  return messages.length > 0 && messages.every(message =>
    message.direction === "inbound" ? message.id.startsWith("shopify-") || message.id.startsWith("meta-lead-")
      : Boolean(message.messageId && input.automaticMessageIds.has(message.messageId.trim().toLowerCase())));
}

export function tagHealthLabel(status?: TagProcessingStatus): string | null {
  if (!status || status === "current") return null;
  return ({ pending: "Tag update pending", waiting_history: "Tag needs email history", needs_review: "Tag needs review", retrying: "Tag update retrying", paused: "AI tagging paused" })[status];
}
