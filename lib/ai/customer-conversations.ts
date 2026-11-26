import { z } from "zod";
import type { InboxEmailItem } from "../email-inbox.ts";
import { groupEmailConversations } from "../email-threading.ts";

export const customerConversationSchema = z.object({
  companyId: z.uuid(), companyName: z.string().max(200),
  state: z.enum(["ready", "unavailable"]),
  threads: z.array(z.object({
    id: z.string().min(1).max(1000), subject: z.string().max(300),
    sender: z.string().max(320), timestamp: z.iso.datetime(), direction: z.enum(["inbound", "outbound"]),
  })).max(20),
  more: z.boolean(),
});
export type CustomerConversations = z.infer<typeof customerConversationSchema>;
export const conversationRequestSchema = z.object({ companyId: z.uuid(), threadId: z.string().min(1).max(1000) }).strict();
export const conversationMessagesSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1).max(1000), sender: z.string().max(320), timestamp: z.iso.datetime(),
    direction: z.enum(["inbound", "outbound"]), body: z.string().max(12000), available: z.boolean(), truncated: z.boolean() })).max(24),
  more: z.boolean(),
});
export type ConversationMessages = z.infer<typeof conversationMessagesSchema>;

export function customerConversationRows(companyId: string, companyName: string, emails: InboxEmailItem[]): CustomerConversations {
  const threads = [...groupEmailConversations(emails)].flatMap(([id, messages]) => {
    const latest = [...messages].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    if (!latest || !Number.isFinite(Date.parse(latest.timestamp))) return [];
    return [{ id: id.slice(0, 1000), subject: latest.subject.slice(0, 300), sender: (latest.direction === "outbound" ? latest.from || "Team" : latest.contactName || latest.from || latest.contact).slice(0, 320),
      timestamp: new Date(latest.timestamp).toISOString(), direction: latest.direction }];
  }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return { companyId, companyName: companyName.slice(0, 200), state: "ready", threads: threads.slice(0, 20), more: threads.length > 20 };
}
