import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";

export type FlowInquiry = {
  source: "shopify" | "meta";
  id: string;
  receivedAt: string;
  fields: Record<string, string | string[]>;
};

/** Bind context to the intake that existed at enrollment, never a later submission. */
export async function loadFlowInquiry(contactId: string, before: string, origin?: { source: string; id: string }): Promise<FlowInquiry | null> {
  const db = createSupabaseAdmin();
  let shopify = db.from("shopify_leads").select("webhook_id,created_at,form_content,raw_payload")
    .eq("contact_id", contactId).eq("status", "processed").lte("created_at", before);
  if (origin?.source === "shopify") shopify = shopify.eq("webhook_id", origin.id);
  const { data: form } = origin?.source === "meta" ? { data: null } : await shopify.order("created_at", { ascending: false }).limit(1).maybeSingle().throwOnError();
  if (form) {
    const payload = form.form_content ?? form.raw_payload ?? {};
    const fields: FlowInquiry["fields"] = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!/^contact\[/.test(key)) continue;
      if (typeof value === "string") fields[key.slice(0, 150)] = value.slice(0, 6000);
      else if (Array.isArray(value)) fields[key.slice(0, 150)] = value.filter((item): item is string => typeof item === "string").slice(0, 50).map(item => item.slice(0, 1000));
    }
    return { source: "shopify", id: form.webhook_id, receivedAt: form.created_at, fields };
  }
  if (origin?.source === "shopify") return null;
  const { data: contact } = await db.from("contacts").select("email,company_id").eq("id", contactId).maybeSingle().throwOnError();
  if (!contact) return null;
  let meta = db.from("meta_leads").select("leadgen_id,created_at,field_data").eq("email", contact.email)
    .eq("company_id", contact.company_id).lte("created_at", before);
  if (origin?.source === "meta") meta = meta.eq("leadgen_id", origin.id);
  const { data: lead } = await meta.order("created_at", { ascending: false }).limit(1).maybeSingle().throwOnError();
  if (!lead) return null;
  const fields: FlowInquiry["fields"] = {};
  for (const field of Array.isArray(lead.field_data) ? lead.field_data : []) {
    if (field && typeof field.name === "string" && Array.isArray(field.values)) fields[field.name.slice(0, 150)] = field.values.filter((value: unknown): value is string => typeof value === "string").slice(0, 50).map((value: string) => value.slice(0, 1000));
  }
  return { source: "meta", id: lead.leadgen_id, receivedAt: lead.created_at, fields };
}
