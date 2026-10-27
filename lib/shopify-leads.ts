import crypto from "node:crypto";

import { env, hasSupabaseConfig } from "./env.ts";
import { createSupabaseAdmin } from "./supabase/admin.ts";
import { claimNextBdSalesManager } from "./lead-assignment.ts";

type UnknownRecord = Record<string, unknown>;

export type ShopifyLead = {
  customerId: string;
  email: string;
  name: string;
  role: string | null;
  phone: string | null;
  companyName: string;
  website: string | null;
  domain: string | null;
  country: string | null;
  city: string | null;
  tags: string[];
  acceptsMarketing: boolean;
  details: Record<string, string | string[] | null>;
  createdAt: string;
  rawPayload: UnknownRecord;
};

export type ShopifyLeadLocation = {
  country: string | null;
  city: string | null;
  ipAddress: string | null;
  source: "form" | "ip" | "unknown";
};

const genericEmailDomains = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "me.com", "yahoo.com", "qq.com", "163.com", "126.com",
  "proton.me", "protonmail.com", "aol.com",
]);

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTags(value: unknown) {
  const tags = Array.isArray(value) ? value : String(value ?? "").split(",");
  return tags.map((tag) => String(tag).trim()).filter(Boolean);
}

function parseNoteFields(value: unknown) {
  const fields: Record<string, string> = {};
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]{2,80})\s*:\s*(.+?)\s*$/);
    if (match) fields[match[1].trim().toLowerCase().replaceAll("_", " ")] = match[2].trim();
  }
  return fields;
}

function field(fields: Record<string, string>, ...names: string[]) {
  for (const name of names) if (fields[name]) return fields[name];
  return null;
}

function normalizeWebsite(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function businessDomain(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? null;
  return domain && !genericEmailDomains.has(domain) ? domain : null;
}

function companyFromDomain(domain: string) {
  const stem = domain.split(".")[0].replaceAll(/[-_]+/g, " ");
  return stem.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countryName(value: string | null) {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return value.trim();
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function getShopifyLeadLocation(headers: Headers, submittedCountry?: string | null, submittedCity?: string | null): ShopifyLeadLocation {
  const formCountry = asString(submittedCountry);
  const geoCountry = asString(headers.get("x-vercel-ip-country")) ?? asString(headers.get("cf-ipcountry"));
  const forwardedIp = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ipAddress = asString(headers.get("x-real-ip")) ?? asString(forwardedIp);
  const headerCity = asString(headers.get("x-vercel-ip-city"));
  let decodedCity = headerCity;
  if (headerCity) {
    try { decodedCity = decodeURIComponent(headerCity); } catch { /* Keep the original header value. */ }
  }
  return {
    country: countryName(formCountry ?? geoCountry),
    city: asString(submittedCity) ?? decodedCity,
    ipAddress: ipAddress?.slice(0, 64) ?? null,
    source: formCountry ? "form" : geoCountry ? "ip" : "unknown",
  };
}

export function estimatedOrderQuantity(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replaceAll(",", "").toLowerCase();
  const numbers = [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (!numbers.length) return null;
  if (/under|less than|below|up to|</.test(normalized)) return Math.round(numbers[0]);
  return Math.round(numbers[0]);
}

export function buildShopifySignature(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

export function verifyShopifySignature(secret: string, body: string, signature: string | null | undefined) {
  if (!secret || !signature) return false;
  const expected = Buffer.from(buildShopifySignature(secret, body));
  const provided = Buffer.from(signature.trim());
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

export function normalizeShopifyCustomer(payload: unknown): ShopifyLead | null {
  const customer = asRecord(payload);
  if (!customer) return null;
  const customerId = asString(customer.id);
  const email = asString(customer.email)?.toLowerCase();
  if (!customerId || !email || !/^\S+@\S+\.\S+$/.test(email)) return null;

  const defaultAddress = asRecord(customer.default_address);
  const firstAddress = Array.isArray(customer.addresses) ? asRecord(customer.addresses[0]) : null;
  const address = defaultAddress ?? firstAddress ?? {};
  const noteFields = parseNoteFields(customer.note);
  const firstName = asString(customer.first_name);
  const lastName = asString(customer.last_name);
  const name = [firstName, lastName].filter(Boolean).join(" ") || email;
  const website = normalizeWebsite(field(noteFields, "website", "company website", "business website"));
  const emailDomain = businessDomain(email);
  const websiteDomain = website ? new URL(website).hostname.replace(/^www\./, "").toLowerCase() : null;
  const domain = websiteDomain ?? emailDomain;
  const companyName = asString(address.company)
    ?? field(noteFields, "company", "company name", "business", "business name")
    ?? (domain ? companyFromDomain(domain) : `${name} (Shopify lead)`);
  const acceptsMarketing = customer.accepts_marketing === true
    || asRecord(customer.email_marketing_consent)?.state === "subscribed";

  return {
    customerId,
    email,
    name,
    role: field(noteFields, "role", "job title", "position"),
    phone: asString(customer.phone) ?? asString(address.phone),
    companyName,
    website,
    domain,
    country: asString(address.country_name) ?? asString(address.country) ?? asString(address.country_code),
    city: asString(address.city),
    tags: parseTags(customer.tags),
    acceptsMarketing,
    details: {},
    createdAt: asString(customer.created_at) ?? new Date().toISOString(),
    rawPayload: customer,
  };
}

function formValue(formData: FormData, name: string) {
  return asString(formData.get(name));
}

export function normalizeShopifyFormLead(formData: FormData, requestHeaders = new Headers()): ShopifyLead | null {
  const submissionId = formValue(formData, "submission_id");
  const email = formValue(formData, "contact[email]")?.toLowerCase();
  const name = formValue(formData, "contact[Name]");
  const companyName = formValue(formData, "contact[Company]");
  if (!submissionId || !/^[0-9a-f-]{20,60}$/i.test(submissionId) || !email || !/^\S+@\S+\.\S+$/.test(email) || !name || !companyName) return null;

  const website = normalizeWebsite(formValue(formData, "contact[Website]"));
  const emailDomain = businessDomain(email);
  const websiteDomain = website ? new URL(website).hostname.replace(/^www\./, "").toLowerCase() : null;
  const materialPrefix = "contact[Material — ";
  const materials = Array.from(formData.entries())
    .filter(([key, value]) => key.startsWith(materialPrefix) && value === "Yes")
    .map(([key]) => key.slice(materialPrefix.length, -1));
  const extras = [
    ["contact[Wants a sample kit]", "Sample kit"],
    ["contact[Wants private label]", "Private label / custom colours"],
    ["contact[Wants dropshipping]", "Dropshipping"],
    ["contact[Wants net terms]", "Net payment terms"],
  ].filter(([key]) => formData.get(key) === "Yes").map(([, label]) => label);

  const location = getShopifyLeadLocation(
    requestHeaders,
    formValue(formData, "contact[Country]") ?? formValue(formData, "contact[Country Code]"),
    formValue(formData, "contact[Region]"),
  );
  const rawPayload = Object.fromEntries(Array.from(formData.entries()).map(([key, value]) => [key, String(value)]));

  return {
    customerId: `form:${submissionId}`,
    email,
    name: name.slice(0, 160),
    role: formValue(formData, "contact[Job title]"),
    phone: formValue(formData, "contact[Phone]"),
    companyName: companyName.slice(0, 160),
    website,
    domain: websiteDomain ?? emailDomain,
    country: location.country,
    city: location.city,
    tags: ["b2b-lead", "shopify-contact-form"],
    acceptsMarketing: false,
    details: {
      estimatedMonthlyVolume: formValue(formData, "contact[Estimated monthly volume]"),
      message: formValue(formData, "contact[body]"),
      businessType: formValue(formData, "contact[Business type]"),
      taxOrResaleId: formValue(formData, "contact[Tax or resale ID]"),
      printersInOperation: formValue(formData, "contact[Printers in operation]"),
      materials,
      extras,
    },
    createdAt: new Date().toISOString(),
    rawPayload: {
      ...rawPayload,
      _crm_location: {
        source: location.source,
        ipAddress: location.ipAddress,
        country: location.country,
        city: location.city,
      },
    },
  };
}

export function hasShopifyLeadTag(tags: string[], requiredTag: string) {
  if (!requiredTag.trim()) return true;
  const expected = requiredTag.trim().toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === expected);
}

export async function saveShopifyLead(lead: ShopifyLead, webhookId: string, shopDomain: string) {
  if (!hasSupabaseConfig()) return { ok: false as const, error: "Supabase is not configured." };
  const admin = createSupabaseAdmin();
  const { data: existingWebhook, error: webhookLookupError } = await admin
    .from("shopify_leads")
    .select("webhook_id,status,company_id,contact_id")
    .eq("webhook_id", webhookId)
    .maybeSingle();
  if (webhookLookupError) return { ok: false as const, error: webhookLookupError.message };
  if (existingWebhook?.status === "processed") {
    return { ok: true as const, duplicate: true, companyId: existingWebhook.company_id, contactId: existingWebhook.contact_id };
  }

  const { error: leadError } = await admin.from("shopify_leads").upsert({
    webhook_id: webhookId,
    shop_domain: shopDomain,
    customer_id: lead.customerId,
    email: lead.email,
    company_name: lead.companyName,
    full_name: lead.name,
    phone: lead.phone,
    tags: lead.tags,
    status: "processing",
    error_message: null,
    raw_payload: lead.rawPayload,
    created_at: lead.createdAt,
  }, { onConflict: "webhook_id" });
  if (leadError) return { ok: false as const, error: leadError.message };

  try {
    const { data: existingContact, error: contactLookupError } = await admin
      .from("contacts")
      .select("id,company_id")
      .eq("email", lead.email)
      .maybeSingle();
    if (contactLookupError) throw contactLookupError;

    let company: { id: string; name: string; source: string | null; country: string | null; city: string | null } | null = null;
    if (existingContact) {
      const result = await admin.from("companies").select("id,name,source,country,city").eq("id", existingContact.company_id).single();
      if (result.error || !result.data) throw result.error ?? new Error("Contact company could not be found.");
      company = result.data;
    } else if (lead.domain) {
      const result = await admin.from("companies").select("id,name,source,country,city").eq("domain", lead.domain).maybeSingle();
      if (result.error) throw result.error;
      company = result.data;
    }
    const createdCompany = !company;
    if (!company) {
      const result = await admin.from("companies").insert({
        name: lead.companyName,
        website: lead.website,
        domain: lead.domain,
        country: lead.country,
        city: lead.city,
        segment: "Shopify B2B lead",
        source: "shopify_b2b_form",
        source_url: `https://${shopDomain}`,
        status: "new",
        discovered_at: lead.createdAt,
      }).select("id,name,source,country,city").single();
      if (result.error || !result.data) throw result.error ?? new Error("Company could not be created.");
      company = result.data;
    } else {
      const companyUpdates: Record<string, string> = {};
      if (lead.country && (!company.country || company.country === "Unknown")) companyUpdates.country = lead.country;
      if (lead.city && !company.city) companyUpdates.city = lead.city;
      if (!company.source?.includes("shopify")) companyUpdates.source = [company.source, "shopify_b2b_form"].filter(Boolean).join("+");
      if (Object.keys(companyUpdates).length) {
        const updateResult = await admin.from("companies").update(companyUpdates).eq("id", company.id);
        if (updateResult.error) throw updateResult.error;
      }
    }

    const quantity = estimatedOrderQuantity(
      typeof lead.details.estimatedMonthlyVolume === "string" ? lead.details.estimatedMonthlyVolume : null,
    );
    const existingPipelineResult = await admin
      .from("pipeline")
      .select("owner_id")
      .eq("company_id", company.id)
      .maybeSingle();
    if (existingPipelineResult.error) throw existingPipelineResult.error;

    const existingOwnerId = existingPipelineResult.data?.owner_id ?? null;
    const assignedOwnerId = existingOwnerId ?? await claimNextBdSalesManager(admin);
    const claimedAutomatically = !existingOwnerId && Boolean(assignedOwnerId);
    let pipelineResult: { error: { message: string } | null };
    if (!existingPipelineResult.data) {
      pipelineResult = await admin.from("pipeline").insert({
        company_id: company.id,
        stage: "new",
        owner_id: assignedOwnerId,
        ...(quantity == null ? {} : { estimated_order_quantity: quantity }),
      });
    } else {
      const pipelineUpdates = {
        ...(claimedAutomatically ? { owner_id: assignedOwnerId } : {}),
        ...(quantity == null ? {} : { estimated_order_quantity: quantity }),
      };
      pipelineResult = Object.keys(pipelineUpdates).length
        ? await admin.from("pipeline").update(pipelineUpdates).eq("company_id", company.id)
        : { error: null };
    }
    if (pipelineResult.error) throw pipelineResult.error;

    let contactId = existingContact?.id ?? null;
    if (existingContact) {
      const updateResult = await admin.from("contacts").update({
        name: lead.name,
        role: lead.role,
        consent_source: lead.acceptsMarketing ? "shopify_b2b_form_opt_in" : "shopify_b2b_form",
      }).eq("id", existingContact.id);
      if (updateResult.error) throw updateResult.error;
    } else {
      const insertResult = await admin.from("contacts").insert({
        company_id: company.id,
        name: lead.name,
        role: lead.role,
        email: lead.email,
        verification_status: "unverified",
        consent_source: lead.acceptsMarketing ? "shopify_b2b_form_opt_in" : "shopify_b2b_form",
      }).select("id").single();
      if (insertResult.error || !insertResult.data) throw insertResult.error ?? new Error("Contact could not be created.");
      contactId = insertResult.data.id;
    }

    const eventResult = await admin.from("events").insert({
      company_id: company.id,
      type: "shopify_b2b_lead_received",
      data: {
        summary: `${lead.name} submitted the Shopify B2B form.`,
        webhook_id: webhookId,
        shopify_customer_id: lead.customerId,
        email: lead.email,
        phone: lead.phone,
        tags: lead.tags,
        details: lead.details,
      },
    });
    if (eventResult.error) throw eventResult.error;

    const completion = await admin.from("shopify_leads").update({
      status: "processed",
      company_id: company.id,
      contact_id: contactId,
      ...(assignedOwnerId ? { owner_id: assignedOwnerId, assignment_method: claimedAutomatically ? "automatic" : "manual" } : {}),
      processed_at: new Date().toISOString(),
    }).eq("webhook_id", webhookId);
    if (completion.error) throw completion.error;
    // A form submission is not an incoming email. Start new-lead flows as
    // soon as the CRM contact and its pipeline have both been saved.
    try {
      const { enrollMatchingFlows, enrollNewLeadFlows } = await import("./data/flow-runtime.ts");
      if (contactId) await enrollNewLeadFlows(contactId);
      if (createdCompany) await enrollMatchingFlows({ type: "company_segment_changed", conversationId: `company:${company.id}`, contactId, companyId: company.id, segment: "Shopify B2B lead", eventKey: `shopify-company:${company.id}` });
    } catch (automationError) {
      console.error("Shopify lead saved, but flow enrollment failed:", automationError);
    }
    return { ok: true as const, duplicate: false, companyId: company.id, contactId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify lead could not be saved.";
    await admin.from("shopify_leads").update({ status: "failed", error_message: message }).eq("webhook_id", webhookId);
    return { ok: false as const, error: message };
  }
}

export function getShopifyWebhookConfig() {
  return {
    secret: env.SHOPIFY_WEBHOOK_SECRET,
    storeDomain: env.SHOPIFY_STORE_DOMAIN,
    requiredTag: env.SHOPIFY_B2B_FORM_TAG,
  };
}

export function getShopifyFormConfig() {
  return {
    origin: new URL(env.SHOPIFY_FORM_ORIGIN).origin,
    formId: env.SHOPIFY_B2B_FORM_ID,
  };
}
