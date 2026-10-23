"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { pipelineStageValues } from "@/lib/types";
import { variantTag } from "@/lib/product-utils";
import { enrollMatchingFlows } from "@/lib/data/flow-runtime";
import { claimNextBdSalesManager } from "@/lib/lead-assignment";

export type CrmActionState = { error?: string; success?: string } | undefined;

export async function addCompanyComment(companyId: string, _state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = z.object({ companyId: z.uuid(), comment: z.string().trim().min(1).max(5000) }).safeParse({ companyId, comment: formData.get("comment") });
  if (!parsed.success) return { error: "Enter a comment of up to 5,000 characters." };
  const admin = createSupabaseAdmin();
  const { data: company, error: companyError } = await admin.from("companies").select("id").eq("id", parsed.data.companyId).maybeSingle();
  if (companyError || !company) return { error: "This customer profile could not be found." };
  const { error } = await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "staff_comment", data: { summary: parsed.data.comment } });
  if (error) return { error: "Your comment could not be posted. Please try again." };
  revalidatePath(`/companies/${company.id}`);
  return { success: "Comment posted." };
}

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
const companyUpdateSchema = companySchema.extend({
  stage: z.enum(pipelineStageValues),
  estimatedOrderQuantity: z.union([z.literal(""), z.coerce.number().int().min(0).max(100_000_000)]),
  estimatedValue: z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000_000)]),
  currency: z.enum(["USD", "EUR", "GBP", "CNY"]),
  nextFollowupAt: optionalDateTime,
  summary: optionalText(5000),
  fitScore: z.union([z.literal(""), z.coerce.number().int().min(1).max(10)]),
  tags: optionalText(2000),
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
  active: z.enum(["true", "false"]).default("true"),
  variants: z.string().max(50_000),
});

const productVariantSchema = z.array(z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(120),
  price: z.string().trim().max(50),
  stockStatus: z.string().trim().max(100),
  imageUrl: z.string().trim().url().max(1000).nullable().or(z.literal("")),
})).min(1).max(100);

function parseProductVariants(value: string) {
  try {
    return productVariantSchema.safeParse(JSON.parse(value));
  } catch {
    return productVariantSchema.safeParse(null);
  }
}

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

function refreshCompany(companyId: string) {
  refreshCrm();
  revalidatePath(`/companies/${companyId}`);
}

async function enrollCompanyEvent(event: Parameters<typeof enrollMatchingFlows>[0]) {
  try { await enrollMatchingFlows(event); }
  catch (error) { console.error("Company change saved, but flow enrollment failed:", error); }
}

export async function createCompany(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
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

  const assignedOwnerId = await claimNextBdSalesManager(admin);
  const relatedWrites = [
    admin.from("pipeline").insert({ company_id: company.id, stage: "new", owner_id: assignedOwnerId }),
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

  const { data: createdContact } = await admin.from("contacts").select("id").eq("company_id", company.id).order("created_at").limit(1).maybeSingle();
  await enrollCompanyEvent({ type: "company_segment_changed", conversationId: `company:${company.id}`, companyId: company.id, contactId: createdContact?.id ?? null, segment: parsed.data.segment });

  refreshCrm();
  return { success: `${parsed.data.name} was added.` };
}

export async function updateCompany(companyId: string, _state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const id = z.string().uuid().safeParse(companyId);
  const parsed = companyUpdateSchema.safeParse({
    name: formData.get("name"), website: formData.get("website"), country: formData.get("country"), city: formData.get("city"),
    segment: formData.get("segment"), contactName: formData.get("contactName"), contactRole: formData.get("contactRole"), contactEmail: formData.get("contactEmail"),
    stage: formData.get("stage"), estimatedOrderQuantity: formData.get("estimatedOrderQuantity") || "", estimatedValue: formData.get("estimatedValue") || "",
    currency: formData.get("currency"), nextFollowupAt: formData.get("nextFollowupAt"), summary: formData.get("summary"), fitScore: formData.get("fitScore") || "", tags: formData.get("tags"),
  });
  if (!id.success || !parsed.success) return { error: "Review the company, contact, and pipeline fields and try again." };
  const website = normalizeWebsite(parsed.data.website);
  if (parsed.data.website && !website) return { error: "Enter a valid company website." };

  const admin = createSupabaseAdmin();
  const [{ data: company }, { data: previousPipeline }] = await Promise.all([
    admin.from("companies").select("id,name,segment").eq("id", id.data).maybeSingle(),
    admin.from("pipeline").select("stage,owner_id").eq("company_id", id.data).maybeSingle(),
  ]);
  if (!company) return { error: "The company no longer exists." };
  const tags = (parsed.data.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 50);
  const writes = await Promise.all([
    admin.from("companies").update({
      name: parsed.data.name, website, domain: domainFromWebsite(website), country: parsed.data.country, city: parsed.data.city || null,
      segment: parsed.data.segment, status: parsed.data.stage === "won" ? "customer" : parsed.data.stage === "lost" ? "disqualified" : "engaged",
    }).eq("id", id.data),
    admin.from("pipeline").upsert({
      company_id: id.data, stage: parsed.data.stage, estimated_order_quantity: parsed.data.estimatedOrderQuantity === "" ? null : parsed.data.estimatedOrderQuantity,
      estimated_value: parsed.data.estimatedValue === "" ? null : parsed.data.estimatedValue, currency: parsed.data.currency,
      next_followup_at: parsed.data.nextFollowupAt ? new Date(parsed.data.nextFollowupAt).toISOString() : null, updated_at: new Date().toISOString(),
    }, { onConflict: "company_id" }),
    admin.from("company_profiles").upsert({
      company_id: id.data, summary: parsed.data.summary || null, fit_score: parsed.data.fitScore === "" ? null : parsed.data.fitScore,
      interest_tags: tags, updated_at: new Date().toISOString(),
    }, { onConflict: "company_id" }),
  ]);
  if (writes.some((result) => result.error)) return { error: "The company could not be updated." };

  const { data: primaryContact } = await admin.from("contacts").select("id").eq("company_id", id.data).order("created_at").limit(1).maybeSingle();
  if (parsed.data.contactEmail) {
    const contactValues = { name: parsed.data.contactName || null, role: parsed.data.contactRole || null, email: parsed.data.contactEmail };
    const contactResult = primaryContact
      ? await admin.from("contacts").update(contactValues).eq("id", primaryContact.id)
      : await admin.from("contacts").insert({ company_id: id.data, ...contactValues, verification_status: "unverified" });
    if (contactResult.error) return { error: "Company details were saved, but the contact email could not be updated." };
  }
  const followupNote = "Scheduled from intelligent next follow-up recommendation.";
  const { data: existingFollowupTask } = await admin.from("crm_tasks").select("id").eq("company_id", id.data).eq("status", "open").eq("notes", followupNote).order("created_at").limit(1).maybeSingle();
  const followupDueAt = parsed.data.nextFollowupAt ? new Date(parsed.data.nextFollowupAt).toISOString() : null;
  const followupTaskResult = followupDueAt
    ? existingFollowupTask
      ? await admin.from("crm_tasks").update({ title: `Follow up ${parsed.data.name}`, assigned_to: previousPipeline?.owner_id ?? viewer.id, due_at: followupDueAt, updated_at: new Date().toISOString() }).eq("id", existingFollowupTask.id)
      : await admin.from("crm_tasks").insert({ company_id: id.data, contact_id: primaryContact?.id ?? null, assigned_to: previousPipeline?.owner_id ?? viewer.id, title: `Follow up ${parsed.data.name}`, notes: followupNote, priority: ["replied", "interested", "big_order"].includes(parsed.data.stage) ? "high" : "normal", due_at: followupDueAt })
    : existingFollowupTask
      ? await admin.from("crm_tasks").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", existingFollowupTask.id)
      : { error: null };
  if (followupTaskResult.error) return { error: "Company details were saved, but the follow-up task could not be scheduled." };
  await admin.from("events").insert({ company_id: id.data, actor_id: viewer.id, type: "company_updated", data: { summary: `${parsed.data.name} details were updated.` } });
  if (followupDueAt) await admin.from("events").insert({ company_id: id.data, actor_id: viewer.id, type: "followup_scheduled", data: { summary: `Next follow-up scheduled for ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(followupDueAt))}.` } });
  const { data: automationContact } = await admin.from("contacts").select("id").eq("company_id", id.data).order("created_at").limit(1).maybeSingle();
  if (company.segment !== parsed.data.segment) await enrollCompanyEvent({ type: "company_segment_changed", conversationId: `company:${id.data}`, companyId: id.data, contactId: automationContact?.id ?? null, segment: parsed.data.segment });
  if (previousPipeline?.stage !== parsed.data.stage) await enrollCompanyEvent({ type: "pipeline_stage_changed", conversationId: `company:${id.data}:pipeline`, companyId: id.data, contactId: automationContact?.id ?? null, stage: parsed.data.stage });
  refreshCompany(id.data);
  return { success: `${parsed.data.name} was updated.` };
}

export async function bulkUpdateCompanies(companyIds: string[], action: string): Promise<CrmActionState> {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), action: z.enum(["contacted", "interested", "delete"]) }).safeParse({ ids: companyIds, action });
  if (!parsed.success) return { error: "Select at least one valid company." };
  const viewer = await requireWorkspaceMember(parsed.data.action === "delete" ? ["admin"] : ["admin", "operator", "bd_manager"]);
  const admin = createSupabaseAdmin();
  if (parsed.data.action === "delete") {
    const { error } = await admin.from("companies").delete().in("id", parsed.data.ids);
    if (error) return { error: "The selected companies could not be deleted." };
    refreshCrm();
    return { success: `${parsed.data.ids.length} ${parsed.data.ids.length === 1 ? "company" : "companies"} deleted.` };
  }
  const rows = parsed.data.ids.map((companyId) => ({ company_id: companyId, stage: parsed.data.action, updated_at: new Date().toISOString() }));
  const { error } = await admin.from("pipeline").upsert(rows, { onConflict: "company_id" });
  if (error) return { error: "The bulk update could not be completed." };
  await admin.from("events").insert(parsed.data.ids.map((companyId) => ({ company_id: companyId, actor_id: viewer.id, type: "bulk_pipeline_update", data: { summary: `Pipeline status changed to ${parsed.data.action}.` } })));
  refreshCrm();
  return { success: `${parsed.data.ids.length} ${parsed.data.ids.length === 1 ? "company" : "companies"} updated.` };
}

export async function createOpportunity(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
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
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_id" });
  if (error) return { error: "The opportunity could not be saved." };
  await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "opportunity_updated", data: { summary: `${company.name} moved to ${parsed.data.stage.replaceAll("_", " ")}.` } });
  refreshCrm();
  return { success: `Opportunity saved for ${company.name}.` };
}

export async function updatePipelineStage(companyId: string, stage: string): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = z.object({ companyId: z.string().uuid(), stage: z.enum(pipelineStageValues) }).safeParse({ companyId, stage });
  if (!parsed.success) return { error: "Invalid pipeline update." };
  const admin = createSupabaseAdmin();
  const { data: company } = await admin.from("companies").select("id,name").eq("id", parsed.data.companyId).maybeSingle();
  if (!company) return { error: "The company no longer exists." };
  const { error } = await admin.from("pipeline").upsert({ company_id: company.id, stage: parsed.data.stage, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) return { error: "The pipeline stage could not be updated." };
  await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "pipeline_stage_changed", data: { summary: `${company.name} moved to ${parsed.data.stage.replaceAll("_", " ")}.` } });
  const { data: contact } = await admin.from("contacts").select("id").eq("company_id", company.id).order("created_at").limit(1).maybeSingle();
  await enrollCompanyEvent({ type: "pipeline_stage_changed", conversationId: `company:${company.id}:pipeline`, companyId: company.id, contactId: contact?.id ?? null, stage: parsed.data.stage });
  refreshCrm();
  return { success: "Pipeline stage updated." };
}

export async function assignPipelineOwner(companyId: string, ownerId: string | null): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = z.object({ companyId: z.string().uuid(), ownerId: z.string().uuid().nullable() }).safeParse({ companyId, ownerId });
  if (!parsed.success) return { error: "Invalid lead assignment." };
  const admin = createSupabaseAdmin();
  const { data: company } = await admin.from("companies").select("id,name").eq("id", parsed.data.companyId).maybeSingle();
  if (!company) return { error: "The company no longer exists." };
  let ownerName = "Unassigned";
  if (parsed.data.ownerId) {
    const { data: member } = await admin.from("workspace_members").select("display_name").eq("user_id", parsed.data.ownerId).eq("role", "bd_manager").eq("auto_assign_leads", true).not("activated_at", "is", null).maybeSingle();
    if (!member) return { error: "Choose an active BD Sales Manager." };
    ownerName = member.display_name || "BD Sales Manager";
  }
  const { error } = await admin.from("pipeline").upsert({ company_id: company.id, owner_id: parsed.data.ownerId, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) return { error: "The lead owner could not be updated." };
  await admin.from("shopify_leads").update({ owner_id: parsed.data.ownerId, assignment_method: parsed.data.ownerId ? "manual" : null }).eq("company_id", company.id);
  await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "lead_owner_changed", data: { summary: parsed.data.ownerId ? `${company.name} was manually assigned to ${ownerName}.` : `${company.name} was returned to the unassigned queue.` } });
  refreshCompany(company.id);
  return { success: parsed.data.ownerId ? `Assigned to ${ownerName}.` : "Lead unassigned." };
}

export async function createEmailDraft(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
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
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
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
  const { data: catalog, error } = await admin.from("catalogs").insert({ company_id: company.id, product_skus: parsed.data.productSkus, currency: parsed.data.currency, version }).select("id").single();
  if (error) return { error: "The catalog selection could not be saved." };
  await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "catalog_created", data: { catalogId: catalog.id, summary: `Catalog v${version} created with ${parsed.data.productSkus.length} products.` } });
  refreshCrm();
  return { success: `Catalog v${version} saved for ${company.name}.` };
}

export async function createProduct(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = productSchema.safeParse({
    sku: formData.get("sku"),
    name: formData.get("name"),
    material: formData.get("material"),
    colors: formData.get("colors") || "",
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
    active: formData.get("active") || "true",
    variants: formData.get("variants") || "[]",
  });
  if (!parsed.success) return { error: "Enter valid product details, pricing, and an optional image URL." };
  const optionalTiersAreComplete = (parsed.data.minimum2 === "") === (parsed.data.price2 === "") && (parsed.data.minimum3 === "") === (parsed.data.price3 === "");
  if (!optionalTiersAreComplete) return { error: "Each optional pricing tier needs both a minimum quantity and a price." };

  const parsedVariants = parseProductVariants(parsed.data.variants);
  if (!parsedVariants.success) return { error: "Add at least one valid product variant." };

  const colors = parsedVariants.data.map((variant) => variant.name);
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
    tags: ["manual", ...tiers.map((tier) => `price-tier:${tier.minimum}:${tier.price}`), variantTag(parsedVariants.data.map((variant) => ({ ...variant, imageUrl: variant.imageUrl || null })))],
    description: `Volume pricing: ${tiers.map((tier) => `${tier.minimum}+ ${parsed.data.currency} ${tier.price.toFixed(2)}`).join("; ")}.`,
    active: parsed.data.active === "true",
    sheet_updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.code === "23505" ? "A product with this SKU already exists." : "The product could not be added." };
  revalidatePath("/catalogs");
  revalidatePath("/catalogs/companies");
  return { success: `${parsed.data.name} was added.` };
}

export async function updateProduct(_state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const originalSku = z.string().trim().min(2).max(100).safeParse(formData.get("originalSku"));
  const parsed = productSchema.safeParse({
    sku: formData.get("sku"), name: formData.get("name"), material: formData.get("material"), colors: formData.get("colors") || "",
    diameter: formData.get("diameter"), weight: formData.get("weight"), currency: formData.get("currency"),
    minimum1: formData.get("minimum1"), price1: formData.get("price1"), minimum2: formData.get("minimum2") || "", price2: formData.get("price2") || "",
    minimum3: formData.get("minimum3") || "", price3: formData.get("price3") || "", stockStatus: formData.get("stockStatus"), leadTime: formData.get("leadTime"),
    imageUrl: formData.get("imageUrl"), active: formData.get("active") || "true", variants: formData.get("variants") || "[]",
  });
  if (!originalSku.success || !parsed.success) return { error: "Enter valid product and pricing details." };
  const parsedVariants = parseProductVariants(parsed.data.variants);
  if (!parsedVariants.success) return { error: "Add at least one valid product variant." };
  const optionalTiersAreComplete = (parsed.data.minimum2 === "") === (parsed.data.price2 === "") && (parsed.data.minimum3 === "") === (parsed.data.price3 === "");
  if (!optionalTiersAreComplete) return { error: "Each optional pricing tier needs both a minimum quantity and a price." };
  const tiers = [
    { minimum: parsed.data.minimum1, price: parsed.data.price1 },
    ...(parsed.data.minimum2 === "" ? [] : [{ minimum: parsed.data.minimum2, price: parsed.data.price2 as number }]),
    ...(parsed.data.minimum3 === "" ? [] : [{ minimum: parsed.data.minimum3, price: parsed.data.price3 as number }]),
  ].sort((a, b) => a.minimum - b.minimum);
  if (new Set(tiers.map((tier) => tier.minimum)).size !== tiers.length) return { error: "Pricing tier quantities must be unique." };
  const colors = parsedVariants.data.map((variant) => variant.name);
  const { error } = await createSupabaseAdmin().from("products").update({
    sku: parsed.data.sku.toUpperCase(), name: parsed.data.name, material: parsed.data.material, color: colors.join(", "),
    diameter: parsed.data.diameter || null, weight: parsed.data.weight || null, price: parsed.data.price1, currency: parsed.data.currency,
    moq: parsed.data.minimum1, stock_status: parsed.data.stockStatus || "Not specified", lead_time: parsed.data.leadTime || "Not specified",
    image_url: parsed.data.imageUrl || null, active: parsed.data.active === "true", sheet_updated_at: new Date().toISOString(),
    tags: ["manual", ...tiers.map((tier) => `price-tier:${tier.minimum}:${tier.price}`), variantTag(parsedVariants.data.map((variant) => ({ ...variant, imageUrl: variant.imageUrl || null })))],
    description: `Volume pricing: ${tiers.map((tier) => `${tier.minimum}+ ${parsed.data.currency} ${tier.price.toFixed(2)}`).join("; ")}.`,
  }).eq("sku", originalSku.data);
  if (error) return { error: error.code === "23505" ? "A product with this SKU already exists." : "The product could not be updated." };
  revalidatePath("/catalogs");
  revalidatePath("/catalogs/companies");
  return { success: `${parsed.data.name} was updated.` };
}
