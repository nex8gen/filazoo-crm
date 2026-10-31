import type { InboxEmailItem } from "./email-inbox.ts";

export type ShopifyInquiryRow = { webhook_id: string; customer_id: string; email: string; full_name: string | null;
  company_name: string; phone: string | null; tags: string[] | null; raw_payload: Record<string, unknown> | null; created_at: string };
export type MetaInquiryRow = { leadgen_id: string; email: string | null; full_name: string | null; field_data: unknown; created_at: string; company_id: string | null };
const field = (payload: Record<string, unknown> | null, key: string) => typeof payload?.[key] === "string" ? (payload[key] as string).trim() : "";
const preview = (body: string) => { const clean = body.replace(/\s+/g, " ").trim(); return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean || "No message preview available."; };

export function buildShopifyFormInboxItems(rows: ShopifyInquiryRow[]): InboxEmailItem[] {
  return rows.map(row => {
    const form = row.customer_id.startsWith("form:");
    const details = [
      field(row.raw_payload, "contact[Business type]") && `Business type: ${field(row.raw_payload, "contact[Business type]")}`,
      field(row.raw_payload, "contact[Estimated monthly volume]") && `Estimated monthly volume: ${field(row.raw_payload, "contact[Estimated monthly volume]")}`,
      (field(row.raw_payload, "contact[Phone]") || row.phone) && `Phone: ${field(row.raw_payload, "contact[Phone]") || row.phone}`,
      field(row.raw_payload, "contact[Website]") && `Website: ${field(row.raw_payload, "contact[Website]")}`,
      row.tags?.length ? `Shopify tags: ${row.tags.join(", ")}` : null,
    ].filter(Boolean);
    const body = [field(row.raw_payload, "contact[body]") || (form ? "A customer submitted the Shopify B2B enquiry form." : "A new Shopify B2B lead was added."), details.length ? details.join("\n") : null].filter(Boolean).join("\n\n");
    return { id: `shopify-${row.webhook_id}`, direction: "inbound", status: form ? "Shopify enquiry" : "Shopify lead",
      subject: `${form ? "Shopify enquiry" : "Shopify lead"} from ${row.company_name}`, contact: row.email,
      contactName: row.full_name || undefined, company: row.company_name, preview: preview(body), body,
      bodyLoaded: true, threadId: `shopify:${row.webhook_id}`, timestamp: row.created_at, source: "shopify" };
  });
}

/** A form submission is represented as a CRM inquiry, never fabricated as a received SMTP message. */
export function buildMetaLeadInboxItems(rows: MetaInquiryRow[]): InboxEmailItem[] {
  return rows.filter(row => row.company_id && row.email).map(row => {
    const answers = Array.isArray(row.field_data) ? row.field_data.flatMap(item => {
      if (!item || typeof item !== "object" || typeof item.name !== "string" || !Array.isArray(item.values)) return [];
      return [`${item.name}: ${item.values.filter((value: unknown) => typeof value === "string").join(", ")}`];
    }) : [];
    const body = ["A customer submitted a Meta lead form.", ...answers].join("\n");
    const name = row.full_name || row.email!;
    return { id: `meta-lead-${row.leadgen_id}`, direction: "inbound", status: "Meta lead form", subject: `Meta enquiry from ${name}`,
      contact: row.email!, contactName: row.full_name || undefined, company: name, companyId: row.company_id,
      body, bodyLoaded: true, preview: preview(body), threadId: `meta-lead:${row.leadgen_id}`, timestamp: row.created_at, source: "crm" };
  });
}
