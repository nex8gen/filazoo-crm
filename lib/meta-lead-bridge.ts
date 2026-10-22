import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const metaId = z.string().trim().regex(/^\d{1,40}$/, "Use the original numeric Meta ID as text.");
const optionalText = z.string().trim().max(500).optional();

export const bridgeLeadSchema = z.object({
  lead_id: metaId,
  page_id: metaId,
  form_id: metaId.optional(),
  ad_id: metaId.optional(),
  created_time: z.iso.datetime({ offset: true }).optional(),
  full_name: optionalText,
  email: z.email().max(320).optional(),
  phone: optionalText,
  company_name: optionalText,
  website: optionalText,
  country: optionalText,
  city: optionalText,
  business_type: optionalText,
  expected_order_quantity: optionalText,
  field_data: z.array(z.union([
    z.object({ name: z.string().min(1).max(200), values: z.array(z.string().max(5000)).max(30) }),
    // Make's New Lead module exposes this equivalent mappable representation.
    z.object({ name: z.string().min(1).max(200), value: z.string().max(5000) }).transform(({ name, value }) => ({ name, values: [value] })),
  ])).max(100).default([]),
}).refine((lead) => Boolean(lead.full_name || lead.email || lead.phone || lead.field_data.length), {
  message: "Map the form answers as well as the lead ID.",
});

export type BridgeLead = z.infer<typeof bridgeLeadSchema>;

export function getBridgeSecret(serverKey: string | undefined, override?: string) {
  if (override) return override.length >= 32 ? override : undefined;
  // Domain separation produces a bridge-only credential without exposing the
  // database key. An explicit override permits independent credential rotation.
  return serverKey ? createHmac("sha256", serverKey).update("filazoo:meta-lead-bridge:v1").digest("hex") : undefined;
}

export function verifyBridgeAuthorization(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

export function bridgeLeadRow(lead: BridgeLead) {
  const fields = Object.fromEntries(lead.field_data.map((field) => [field.name.toLowerCase(), field.values.join(", ")]));
  const extraFields = ["company_name", "website", "country", "city", "business_type", "expected_order_quantity"] as const;
  const fieldData = [...lead.field_data.filter((field) => !extraFields.some((key) => lead[key] && field.name.toLowerCase() === key)),
    ...extraFields.flatMap((key) => lead[key] ? [{ name: key, values: [lead[key]!] }] : [])];
  return {
    leadgen_id: lead.lead_id,
    page_id: lead.page_id,
    form_id: lead.form_id ?? null,
    ad_id: lead.ad_id ?? null,
    full_name: lead.full_name || fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(" ") || null,
    email: lead.email || fields.email || null,
    phone: lead.phone || fields.phone_number || fields.phone || null,
    field_data: fieldData,
    raw_payload: { source: "make_bridge", detail: lead },
    // Omit the timestamp when absent so the database supplies its default.
    ...(lead.created_time ? { created_at: lead.created_time } : {}),
  };
}
