"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { pipelineStageValues } from "@/lib/types";
import { variantTag } from "@/lib/product-utils";
import { enrollMatchingFlows, enrollNewLeadFlows } from "@/lib/data/flow-runtime";
import { claimNextBdSalesManager } from "@/lib/lead-assignment";
import { commerceSchema } from "@/lib/company-commerce";
import { ensureCompanyCatalogPdf } from "@/lib/data/catalog-pdfs";
import { companyProfileChangesSchema } from "@/lib/company-profile-fields";
import { productEditMetadata } from "@/lib/product-edit-metadata";

export type CrmActionState = { error?: string; success?: string; companyId?: string } | undefined;

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
  ["/", "/companies", "/segments", "/pipeline", "/emails", "/catalogs", "/catalogs/companies"].forEach((path) => revalidatePath(path));
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
  if (createdContact) await enrollNewLeadFlows(createdContact.id);
  await enrollCompanyEvent({ type: "company_segment_changed", conversationId: `company:${company.id}`, companyId: company.id, contactId: createdContact?.id ?? null, segment: parsed.data.segment });

  refreshCrm();
  return { success: `${parsed.data.name} was added.`, companyId: company.id };
}

export async function updateCompanyFields(companyId: string, input: unknown): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  if (!z.uuid().safeParse(companyId).success) return { error: "Choose a valid company profile." };
  const parsed = companyProfileChangesSchema.safeParse(input);
  if (!parsed.success) return { error: `Check ${parsed.error.issues[0]?.path.join(".") || "the requested fields"}: ${parsed.error.issues[0]?.message || "invalid value"}` };
  const changes = parsed.data;
  if (changes.website !== undefined) {
    const website = normalizeWebsite(changes.website);
    if (changes.website && !website) return { error: "Enter a valid company website." };
    changes.website = website || "";
  }
  const { data, error } = await createSupabaseAdmin().rpc("patch_company_profile_fields", { p_company_id: companyId, p_actor_id: viewer.id, p_changes: changes });
  if (error) return { error: error.code === "23505" ? "This website or contact email already belongs to another profile." : error.code === "P0001" ? error.message : "The requested profile fields could not be saved. Please retry." };
  if (!data?.companyName) return { error: "The profile update could not be confirmed. Refresh before retrying." };
  if (data.contactCreated && data.contactId) {
    try { await enrollNewLeadFlows(data.contactId); }
    catch (reason) { console.error("Contact saved, but flow enrollment failed:", reason); }
  }
  if (data.segmentChanged) await enrollCompanyEvent({ type: "company_segment_changed", conversationId: `company:${companyId}`, companyId, contactId: data.contactId, segment: changes.segment! });
  if (data.stageChanged) await enrollCompanyEvent({ type: "pipeline_stage_changed", conversationId: `company:${companyId}:pipeline`, companyId, contactId: data.contactId, stage: changes.stage! });
  refreshCompany(companyId);
  return { success: `${data.companyName} was updated.` };
}

export async function updateCompany(companyId: string, _state: CrmActionState, formData: FormData): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const id = z.string().uuid().safeParse(companyId);
  const commerce = commerceSchema.safeParse(Object.fromEntries(Object.keys(commerceSchema.shape).map((key) => [key, formData.get(`commerce.${key}`) ?? ""])));
  if (!commerce.success) return { error: "Review the billing email, payment terms, and shipping details." };
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
  const [{ data: company }, { data: previousPipeline, error: pipelineReadError }] = await Promise.all([
    admin.from("companies").select("id,name,segment").eq("id", id.data).maybeSingle(),
    admin.from("pipeline").select("stage,owner_id,next_followup_at").eq("company_id", id.data).maybeSingle(),
  ]);
  if (!company) return { error: "The company no longer exists." };
  if (pipelineReadError) return { error: "The pipeline could not be loaded. Please try again." };
  const tags = (parsed.data.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 50);
  const existingBilling = await admin.from("customer_billing_profiles").select("profile").eq("company_id", id.data).maybeSingle();
  if (existingBilling.error) return { error: "Billing details could not be loaded. Please try again." };
  const writes = await Promise.all([
    admin.from("customer_billing_profiles").upsert({ company_id: id.data, profile: { ...existingBilling.data?.profile, ...commerce.data }, updated_by: viewer.id, updated_at: new Date().toISOString() }),
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

  const { data: primaryContact } = await admin.from("contacts").select("id").eq("company_id", id.data).order("created_at").order("id").limit(1).maybeSingle();
  if (parsed.data.contactEmail) {
    const contactValues = { name: parsed.data.contactName || null, role: parsed.data.contactRole || null, email: parsed.data.contactEmail };
    const contactResult = primaryContact
      ? await admin.from("contacts").update(contactValues).eq("id", primaryContact.id)
      : await admin.from("contacts").insert({ company_id: id.data, ...contactValues, verification_status: "unverified" });
    if (contactResult.error) return { error: "Company details were saved, but the contact email could not be updated." };
  }
  const followupDueAt = parsed.data.nextFollowupAt ? new Date(parsed.data.nextFollowupAt).toISOString() : null;
  await admin.from("events").insert({ company_id: id.data, actor_id: viewer.id, type: "company_updated", data: { summary: `${parsed.data.name} details were updated.` } });
  if (followupDueAt && followupDueAt !== previousPipeline?.next_followup_at) await admin.from("events").insert({ company_id: id.data, actor_id: viewer.id, type: "followup_scheduled", data: { summary: `Next follow-up scheduled for ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(followupDueAt))}.` } });
  const { data: automationContact } = await admin.from("contacts").select("id").eq("company_id", id.data).order("created_at").limit(1).maybeSingle();
  if (!primaryContact && parsed.data.contactEmail && automationContact) await enrollNewLeadFlows(automationContact.id);
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
    const { data, error } = await admin.from("companies").delete().in("id", parsed.data.ids).select("id");
    if (error) return { error: "The selected companies could not be deleted." };
    if (!data?.length) return { error: "The selected companies no longer exist. Refresh the list and try again." };
    refreshCrm();
    parsed.data.ids.forEach((id) => revalidatePath(`/companies/${id}`));
    revalidatePath("/invoices");
    return { success: `${data.length} ${data.length === 1 ? "company" : "companies"} deleted.` };
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
  refreshCompany(company.id);
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
  refreshCompany(company.id);
  return { success: "Pipeline stage updated." };
}

export async function assignPipelineOwner(companyId: string, ownerId: string | null): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = z.object({ companyId: z.string().uuid(), ownerId: z.string().uuid().nullable() }).safeParse({ companyId, ownerId });
  if (!parsed.success) return { error: "Invalid lead assignment." };
  const admin = createSupabaseAdmin();
  const { data: ownerName, error } = await admin.rpc("assign_company_owner", {
    p_company_id: parsed.data.companyId, p_owner_id: parsed.data.ownerId, p_actor_id: viewer.id,
  });
  if (error) return { error: "The lead owner could not be updated." };
  refreshCompany(parsed.data.companyId);
  return { success: parsed.data.ownerId ? `Assigned to ${ownerName}.` : "Lead unassigned." };
}

export async function scheduleCompanyFollowup(companyId: string, dueAt: string): Promise<CrmActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = z.object({ companyId: z.uuid(), dueAt: z.union([z.literal(""), z.iso.datetime({ offset: true })]) }).safeParse({ companyId, dueAt });
  if (!parsed.success) return { error: "Choose a valid follow-up date and time." };
  const admin = createSupabaseAdmin();
  const { data: company, error: readError } = await admin.from("companies").select("id").eq("id", parsed.data.companyId).maybeSingle();
  if (readError || !company) return { error: "The company could not be loaded. Please refresh and retry." };
  // The database trigger saves/cancels the owner's task in this transaction.
  const { error } = await admin.from("pipeline").upsert({ company_id: company.id, next_followup_at: parsed.data.dueAt || null }, { onConflict: "company_id" });
  if (error) return { error: "The follow-up could not be saved. Please retry." };
  const { error: auditError } = await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id,
    type: parsed.data.dueAt ? "followup_scheduled" : "followup_cancelled",
    data: { summary: parsed.data.dueAt ? `Next follow-up scheduled for ${parsed.data.dueAt}.` : "Scheduled follow-up cancelled.", dueAt: parsed.data.dueAt || null },
  });
  refreshCompany(company.id);
  if (auditError) return { error: "The follow-up was saved, but its activity entry could not be recorded. Refresh before retrying." };
  return { success: parsed.data.dueAt ? "Follow-up scheduled." : "Follow-up cancelled." };
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
  const { data: catalog, error } = await admin.from("catalogs").insert({ company_id: company.id, product_skus: parsed.data.productSkus, currency: parsed.data.currency, version }).select("id,price_date,created_at").single();
  if (error) return { error: "The catalog selection could not be saved." };
  await admin.from("events").insert({ company_id: company.id, actor_id: viewer.id, type: "catalog_created", data: { catalogId: catalog.id, summary: `Catalog v${version} created with ${parsed.data.productSkus.length} products.` } });
  let pdfReady = false;
  try {
    await ensureCompanyCatalogPdf({ id: catalog.id, company: company.name, productSkus: parsed.data.productSkus, currency: parsed.data.currency, version, priceDate: catalog.price_date, createdAt: catalog.created_at, pdfUrl: null });
    pdfReady = true;
  } catch (error) { console.error("New catalog PDF generation failed", catalog.id, error); }
  refreshCrm();
  return { success: `Catalog v${version} saved for ${company.name}. ${pdfReady ? "PDF ready to preview and download." : "PDF preparation is pending; use Preview to retry."}` };
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
  const admin = createSupabaseAdmin();
  const current = await admin.from("products").select("sku,tags,description,sheet_updated_at").eq("sku", originalSku.data).maybeSingle();
  if (current.error || !current.data) return { error: "This product is unavailable. Refresh Products before editing." };
  const metadata = productEditMetadata(current.data, [...tiers.map((tier) => `price-tier:${tier.minimum}:${tier.price}`), variantTag(parsedVariants.data.map((variant) => ({ ...variant, imageUrl: variant.imageUrl || null })))], `Volume pricing: ${tiers.map((tier) => `${tier.minimum}+ ${parsed.data.currency} ${tier.price.toFixed(2)}`).join("; ")}.`);
  const update = admin.from("products").update({
    sku: parsed.data.sku.toUpperCase(), name: parsed.data.name, material: parsed.data.material, color: colors.join(", "),
    diameter: parsed.data.diameter || null, weight: parsed.data.weight || null, price: parsed.data.price1, currency: parsed.data.currency,
    moq: parsed.data.minimum1, stock_status: parsed.data.stockStatus || "Not specified", lead_time: parsed.data.leadTime || "Not specified",
    image_url: parsed.data.imageUrl || null, active: parsed.data.active === "true", sheet_updated_at: new Date().toISOString(),
    ...metadata,
  }).eq("sku", originalSku.data);
  const guarded = current.data.sheet_updated_at === null ? update.is("sheet_updated_at", null) : update.eq("sheet_updated_at", current.data.sheet_updated_at);
  const { data: saved, error } = await guarded.select("sku").maybeSingle();
  if (error) return { error: error.code === "23505" ? "A product with this SKU already exists." : "The product could not be updated." };
  if (!saved) return { error: "This product changed or was removed. Refresh Products and try again." };
  revalidatePath("/catalogs");
  revalidatePath("/catalogs/companies");
  return { success: `${parsed.data.name} was updated.` };
}
