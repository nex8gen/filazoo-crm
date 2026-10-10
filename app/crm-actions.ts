"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { pipelineStageValues } from "@/lib/types";

export type CrmActionState = { error?: string; success?: string } | undefined;

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const optionalDateTime = z.union([
  z.literal(""),
  z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date and time"),
]);
const companySchema = z.object({
  name: z.string().trim().min(2).max(160),
  website: optionalText(500),
  country: z.string().trim().min(2).max(100),
  city: optionalText(100),
  segment: z.string().trim().min(2).max(120),
  contactName: optionalText(120),
  contactRole: optionalText(120),
  contactEmail: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
});
const opportunitySchema = z.object({
  companyId: z.string().uuid(),
  stage: z.enum(pipelineStageValues),
  estimatedValue: z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000_000)]),
  currency: z.enum(["USD", "EUR", "GBP", "CNY"]),
  nextFollowupAt: optionalDateTime,
  notes: optionalText(2000),
});
const emailSchema = z.object({
  contactId: z.string().uuid(),
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(10).max(20_000),
});
const catalogSchema = z.object({
  companyId: z.string().uuid(),
  currency: z.enum(["USD", "EUR", "GBP", "CNY"]),
  productSkus: z.array(z.string().trim().min(1).max(100)).max(100),
});
const productSchema = z.object({
  sku: z.string().trim().min(2).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  name: z.string().trim().min(2).max(160),
  material: z.string().trim().min(1).max(100),
  colors: z.string().trim().min(1).max(2000),
  diameter: optionalText(50),
  weight: optionalText(50),
  currency: z.enum(["USD", "EUR", "GBP", "CNY"]),
  minimum1: z.coerce.number().int().min(1).max(1_000_000),
  price1: z.coerce.number().min(0).max(1_000_000),
  minimum2: z.union([z.literal(""), z.coerce.number().int().min(1).max(1_000_000)]),
  price2: z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000)]),
  minimum3: z.union([z.literal(""), z.coerce.number().int().min(1).max(1_000_000)]),
  price3: z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000)]),
  stockStatus: optionalText(100),
  leadTime: optionalText(100),
  imageUrl: z.string().trim().url().max(1000).optional().or(z.literal("")),
});

function normalizeWebsite(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).toString();
  } catch {
    return null;
  }
}

function domainFromWebsite(website: string | null) {
  if (!website) return null;
  return new URL(website).hostname.replace(/^www\./, "").toLowerCase();
}

function refreshCrm() {
  ["/", "/companies", "/pipeline", "/emails", "/catalogs", "/catalogs/companies"].forEach((path) => revalidatePath(path));
}

export async function createCompany(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator"]);
  const parsed = companySchema.safeParse({
    name: formData.get("name"),
    website: formData.get("website"),
    country: formData.get("country"),
    city: formData.get("city"),
    segment: formData.get("segment"),
    contactName: formData.get("contactName"),
    contactRole: formData.get("contactRole"),
    contactEmail: formData.get("contactEmail"),
  });
  if (!parsed.success) return { error: "Enter a company name, country, segment, and a valid optional contact email." };

  const website = normalizeWebsite(parsed.data.website);
  if (parsed.data.website && !website) return { error: "Enter a valid company website." };
  const admin = createSupabaseAdmin();
  const { data: company, error: companyError } = await admin
    .from("companies")
    .insert({
      name: parsed.data.name,
      website,
      domain: domainFromWebsite(website),
      country: parsed.data.country,
      city: parsed.data.city || null,
      segment: parsed.data.segment,
      source: "manual",
      status: "new",
    })
    .select("id")
    .single();
  if (companyError || !company) {
    return { error: companyError?.code === "23505" ? "A company with this domain already exists." : "The company could not be created." };
  }

  const relatedWrites = [
    admin.from("pipeline").insert({ company_id: company.id, stage: "new", owner_id: viewer.id }),
    admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "company_created", data: { summary: `${parsed.data.name} was added manually.` } }),
  ];
  if (parsed.data.contactEmail) {
    relatedWrites.push(admin.from("contacts").insert({
      company_id: company.id,
      name: parsed.data.contactName || null,
      role: parsed.data.contactRole || null,
      email: parsed.data.contactEmail,
      verification_status: "unverified",
    }));
  }
  const relatedResults = await Promise.all(relatedWrites);
  if (relatedResults.some((result) => result.error)) {
    await admin.from("companies").delete().eq("id", company.id);
    return { error: "The company details could not be saved. No partial record was kept." };
  }

  refreshCrm();
  return { success: `${parsed.data.name} was added.` };
}

export async function createOpportunity(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator"]);
  const parsed = opportunitySchema.safeParse({
    companyId: formData.get("companyId"),
    stage: formData.get("stage"),
    estimatedValue: formData.get("estimatedValue") || "",
    currency: formData.get("currency"),
    nextFollowupAt: formData.get("nextFollowupAt"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { error: "Choose a company and enter valid opportunity details." };

  const admin = createSupabaseAdmin();
  const { data: company } = await admin.from("companies").select("id,name").eq("id", parsed.data.companyId).maybeSingle();
  if (!company) return { error: "The selected company no longer exists." };
  const { error } = await admin.from("pipeline").upsert({
    company_id: company.id,
    stage: parsed.data.stage,
    estimated_value: parsed.data.estimatedValue === "" ? null : parsed.data.estimatedValue,
    currency: parsed.data.currency,
    next_followup_at: parsed.data.nextFollowupAt ? new Date(parsed.data.nextFollowupAt).toISOString() : null,
    notes: parsed.data.notes || null,
    owner_id: viewer.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_id" });
  if (error) return { error: "The opportunity could not be saved." };
  await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "opportunity_updated", data: { summary: `${company.name} moved to ${parsed.data.stage.replaceAll("_", " ")}.` } });
  refreshCrm();
  return { success: `Opportunity saved for ${company.name}.` };
}

export async function updatePipelineStage(companyId: string, stage: string): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator"]);
  const parsed = z.object({ companyId: z.string().uuid(), stage: z.enum(pipelineStageValues) }).safeParse({ companyId, stage });
  if (!parsed.success) return { error: "Invalid pipeline update." };
  const admin = createSupabaseAdmin();
  const { data: company } = await admin.from("companies").select("id,name").eq("id", parsed.data.companyId).maybeSingle();
  if (!company) return { error: "The company no longer exists." };
  const { error } = await admin.from("pipeline").upsert({ company_id: company.id, stage: parsed.data.stage, owner_id: viewer.id, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) return { error: "The pipeline stage could not be updated." };
  await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "pipeline_stage_changed", data: { summary: `${company.name} moved to ${parsed.data.stage.replaceAll("_", " ")}.` } });
  refreshCrm();
  return { success: "Pipeline stage updated." };
}

export async function createEmailDraft(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator"]);
  const parsed = emailSchema.safeParse({ contactId: formData.get("contactId"), subject: formData.get("subject"), body: formData.get("body") });
  if (!parsed.success) return { error: "Choose a contact and enter a subject and message." };
  const admin = createSupabaseAdmin();
  const { data: contact } = await admin.from("contacts").select("id,company_id,email,unsubscribed,verification_status").eq("id", parsed.data.contactId).maybeSingle();
  if (!contact) return { error: "The selected contact no longer exists." };
  if (contact.unsubscribed) return { error: "This contact is unsubscribed and cannot receive outreach." };
  const { error } = await admin.from("emails").insert({ contact_id: contact.id, direction: "sent", subject: parsed.data.subject, body: parsed.data.body, status: "draft", step: 1 });
  if (error) return { error: "The email draft could not be saved." };
  await admin.from("events").insert({ company_id: contact.company_id, actor_id: viewer.id, type: "email_draft_created", data: { summary: `Draft created for ${contact.email}.` } });
  refreshCrm();
  return { success: "Draft saved. Nothing was sent." };
}

export async function createCatalog(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator"]);
  const parsed = catalogSchema.safeParse({ companyId: formData.get("companyId"), currency: formData.get("currency"), productSkus: formData.getAll("productSkus") });
  if (!parsed.success) return { error: "Choose a company and valid catalog options." };
  const admin = createSupabaseAdmin();
  const { data: company } = await admin.from("companies").select("id,name").eq("id", parsed.data.companyId).maybeSingle();
  if (!company) return { error: "The selected company no longer exists." };
  if (parsed.data.productSkus.length) {
    const { count } = await admin.from("products").select("sku", { count: "exact", head: true }).in("sku", parsed.data.productSkus).eq("active", true);
    if (count !== parsed.data.productSkus.length) return { error: "One or more selected products are no longer active." };
  }
  const { data: latest } = await admin.from("catalogs").select("version").eq("company_id", company.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (latest?.version ?? 0) + 1;
  const { error } = await admin.from("catalogs").insert({ company_id: company.id, product_skus: parsed.data.productSkus, currency: parsed.data.currency, version });
  if (error) return { error: "The catalog selection could not be saved." };
  await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "catalog_created", data: { summary: `Catalog v${version} created with ${parsed.data.productSkus.length} products.` } });
  refreshCrm();
  return { success: `Catalog v${version} saved for ${company.name}.` };
}

export async function createProduct(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  await requireWorkspaceMember(["admin", "operator"]);
  const parsed = productSchema.safeParse({
    sku: formData.get("sku"),
    name: formData.get("name"),
    material: formData.get("material"),
    colors: formData.get("colors"),
    diameter: formData.get("diameter"),
    weight: formData.get("weight"),
    currency: formData.get("currency"),
    minimum1: formData.get("minimum1"),
    price1: formData.get("price1"),
    minimum2: formData.get("minimum2") || "",
    price2: formData.get("price2") || "",
    minimum3: formData.get("minimum3") || "",
    price3: formData.get("price3") || "",
    stockStatus: formData.get("stockStatus"),
    leadTime: formData.get("leadTime"),
    imageUrl: formData.get("imageUrl"),
  });
  if (!parsed.success) return { error: "Enter valid product details, pricing, and an optional image URL." };
  const optionalTiersAreComplete = (parsed.data.minimum2 === "") === (parsed.data.price2 === "") && (parsed.data.minimum3 === "") === (parsed.data.price3 === "");
  if (!optionalTiersAreComplete) return { error: "Each optional pricing tier needs both a minimum quantity and a price." };

  const colors = parsed.data.colors.split(",").map((color) => color.trim()).filter(Boolean);
  const tiers = [
    { minimum: parsed.data.minimum1, price: parsed.data.price1 },
    ...(parsed.data.minimum2 === "" ? [] : [{ minimum: parsed.data.minimum2, price: parsed.data.price2 as number }]),
    ...(parsed.data.minimum3 === "" ? [] : [{ minimum: parsed.data.minimum3, price: parsed.data.price3 as number }]),
  ].sort((a, b) => a.minimum - b.minimum);
  if (new Set(tiers.map((tier) => tier.minimum)).size !== tiers.length) return { error: "Pricing tier quantities must be unique." };

  const { error } = await createSupabaseAdmin().from("products").insert({
    sku: parsed.data.sku.toUpperCase(),
    name: parsed.data.name,
    material: parsed.data.material,
    color: colors.join(", "),
    diameter: parsed.data.diameter || null,
    weight: parsed.data.weight || null,
    price: parsed.data.price1,
    currency: parsed.data.currency,
    moq: parsed.data.minimum1,
    stock_status: parsed.data.stockStatus || "Not specified",
    lead_time: parsed.data.leadTime || "Not specified",
    image_url: parsed.data.imageUrl || null,
    tags: ["manual", ...tiers.map((tier) => `price-tier:${tier.minimum}:${tier.price}`)],
    description: `Volume pricing: ${tiers.map((tier) => `${tier.minimum}+ ${parsed.data.currency} ${tier.price.toFixed(2)}`).join("; ")}.`,
    active: true,
    sheet_updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.code === "23505" ? "A product with this SKU already exists." : "The product could not be added." };
  revalidatePath("/catalogs");
  revalidatePath("/catalogs/companies");
  return { success: `${parsed.data.name} was added.` };
}
