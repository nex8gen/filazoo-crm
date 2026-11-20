import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { buildMetaLeadInboxItems, buildShopifyFormInboxItems, type MetaInquiryRow, type ShopifyInquiryRow } from "../lead-inquiries.ts";
import type { InboxEmailItem } from "../email-inbox.ts";

export async function listMetaLeadInquiries() {
  const messages: InboxEmailItem[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data } = await createSupabaseAdmin().from("meta_leads").select("leadgen_id,email,full_name,field_data,created_at,company_id")
      .not("company_id", "is", null).not("email", "is", null).order("created_at", { ascending: false }).range(offset, offset + 499).throwOnError();
    messages.push(...buildMetaLeadInboxItems((data ?? []) as MetaInquiryRow[]));
    if ((data?.length ?? 0) < 500) return messages;
  }
}

/** Only an explicit thread key links a form to email replies. Same email/company or subject is insufficient. */
export async function withLeadInquiryOrigins(messages: InboxEmailItem[]): Promise<InboxEmailItem[]> {
  const db = createSupabaseAdmin();
  const legacy = [...new Set(messages.flatMap(message => message.threadId?.startsWith("company:") ? [message.threadId] : []))];
  const originsByThread = new Map<string, Set<string>>();
  for (let offset = 0; offset < legacy.length; offset += 100) {
    const { data } = await db.from("flow_runs").select("conversation_id,context,contacts(email)").in("conversation_id", legacy.slice(offset, offset + 100)).throwOnError();
    for (const row of data ?? []) {
      const origin = row.context?.inquiryOrigin;
      const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
      if (!origin || typeof origin.id !== "string" || !["shopify", "meta", "meta-lead"].includes(origin.source) || !contact?.email) continue;
      const key = `${row.conversation_id}\n${contact.email.trim().toLowerCase()}`;
      const matches = originsByThread.get(key) ?? new Set<string>();
      matches.add(`${origin.source === "shopify" ? "shopify" : "meta-lead"}:${origin.id}`);
      originsByThread.set(key, matches);
    }
  }
  messages = messages.map(message => {
    const origins = originsByThread.get(`${message.threadId}\n${message.contact.trim().toLowerCase()}`);
    return origins?.size === 1 ? { ...message, tagThreadAliases: [...new Set([...(message.tagThreadAliases ?? []), message.threadId!])], threadId: [...origins][0] } : message;
  });
  const ids = (prefix: string) => [...new Set(messages.flatMap(message => message.threadId?.startsWith(prefix) ? [message.threadId.slice(prefix.length)] : []))];
  const shopify = ids("shopify:"), meta = ids("meta-lead:");
  const origins: InboxEmailItem[] = [];
  for (let offset = 0; offset < shopify.length; offset += 100) {
    const { data } = await db.from("shopify_leads").select("webhook_id,customer_id,email,full_name,company_name,phone,tags,raw_payload,created_at")
      .eq("status", "processed").in("webhook_id", shopify.slice(offset, offset + 100)).throwOnError();
    origins.push(...buildShopifyFormInboxItems((data ?? []) as ShopifyInquiryRow[]));
  }
  for (let offset = 0; offset < meta.length; offset += 100) {
    const { data } = await db.from("meta_leads").select("leadgen_id,email,full_name,field_data,created_at,company_id")
      .in("leadgen_id", meta.slice(offset, offset + 100)).throwOnError();
    origins.push(...buildMetaLeadInboxItems((data ?? []) as MetaInquiryRow[]));
  }
  const present = new Set(messages.map(message => message.id));
  return [...messages, ...origins.filter(origin => !present.has(origin.id)
    && messages.some(message => message.threadId === origin.threadId && message.contact.trim().toLowerCase() === origin.contact.trim().toLowerCase()))];
}
