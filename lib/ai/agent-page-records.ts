import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { getMetaInboxData } from "../meta-messenger";
import { listWorkspaceFlows } from "../data/flows";

export async function loadAgentFlow(flowId: string) {
  const flow = (await listWorkspaceFlows()).find((item) => item.id === flowId);
  if (!flow) throw new Error("The selected flow is unavailable.");
  return flow;
}

export async function loadAgentConversation(conversationId: string) {
  // Resolve composite UI identifiers through the same workspace inbox first.
  const thread = (await getMetaInboxData()).threads.find((item) => item.id === conversationId);
  if (!thread) throw new Error("The selected conversation is unavailable.");
  const source = { facebook: "facebook_messenger", instagram: "instagram_messaging", whatsapp: "twilio_whatsapp" }[thread.channel];
  const { data, error } = await createSupabaseAdmin().from("meta_messages")
    .select("id,direction,body,message_type,status,created_at")
    .eq("thread_id", thread.customerId).eq("page_id", thread.pageId).eq("source", source)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(25);
  if (error) throw new Error("Unable to read the selected conversation.");
  return { id: thread.id, customer: thread.customer, channel: thread.channel, replyWindowOpen: thread.replyWindowOpen,
    messages: [...(data ?? [])].reverse().map((message) => ({ id: message.id, direction: message.direction, text: String(message.body ?? "").slice(0, 12000), truncated: String(message.body ?? "").length > 12000, timestamp: message.created_at })),
    coverage: "up to 25 recent saved messages; text limited to 12000 characters per message" };
}
