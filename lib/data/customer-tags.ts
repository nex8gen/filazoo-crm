import { createSupabaseAdmin } from "../supabase/admin.ts";
import { emailTagMessageKey, isCustomerTag, type CustomerTag } from "../customer-tags.ts";

export async function listSharedEmailTags() {
  const tags = new Map<string, CustomerTag | null>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await createSupabaseAdmin().from("crm_email_tags")
      .select("message_key,tag").order("message_key").range(offset, offset + 499);
    if (error) throw new Error(`Unable to load customer tags: ${error.message}`);
    for (const row of data ?? []) tags.set(row.message_key, isCustomerTag(row.tag) ? row.tag : null);
    if ((data?.length ?? 0) < 500) break;
  }
  return tags;
}

/** Conversation aliases share one tag; replaced message tags are cleared in the same write. */
export async function saveSharedEmailTag(input: {
  messageKey: string; tag: CustomerTag | null; contactEmail?: string | null; companyId?: string | null;
  conversationKeys?: string[]; messageKeys?: string[];
  source?: "manual" | "flow";
}) {
  const admin = createSupabaseAdmin();
  const messageKey = emailTagMessageKey({ id: input.messageKey });
  const { data: previous, error: readError } = await admin.from("crm_email_tags").select("tag,company_id,contact_email")
    .eq("message_key", messageKey).maybeSingle();
  if (readError) throw new Error(`Unable to load customer tag: ${readError.message}`);
  const contactEmail = input.contactEmail?.trim().toLowerCase() || previous?.contact_email || null;
  const { data: contact, error: contactError } = contactEmail
    ? await admin.from("contacts").select("company_id").eq("email", contactEmail).limit(1).maybeSingle()
    : { data: null, error: null };
  if (contactError) throw new Error(`Unable to match customer tag: ${contactError.message}`);
  const shared = {
    source: input.source ?? "manual",
    company_id: contact?.company_id ?? input.companyId ?? previous?.company_id ?? null,
    contact_email: contactEmail, updated_at: new Date().toISOString(),
  };
  const keys = [...new Set([messageKey, ...(input.conversationKeys ?? [])])];
  const rows = [
    ...keys.map(key => ({ ...shared, message_key: key, tag: input.tag })),
    ...[...new Set(input.messageKeys ?? [])].filter(key => !keys.includes(key)).map(key => ({ ...shared, message_key: key, tag: null })),
  ];
  const { error } = await admin.from("crm_email_tags").upsert(rows.length === 1 ? rows[0] : rows, { onConflict: "message_key" });
  if (error) throw new Error(`Unable to save customer tag: ${error.message}`);
  return { categoryChanged: previous?.tag !== input.tag, previousCategory: previous?.tag ?? null };
}
