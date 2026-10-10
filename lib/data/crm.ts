import "server-only";

import { requireWorkspaceMember } from "@/lib/auth";
import { formatRelativeDate, getInitials, getPipelineStageLabel } from "@/lib/crm-model";
import { env, hasSupabaseConfig } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActivityItem, Company, DataMode, EmailDraft, Product } from "@/lib/types";

type Relation<T> = T | T[] | null;

type CompanyRow = {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  country: string | null;
  segment: string | null;
  status: string;
  company_profiles: Relation<{
    summary: string | null;
    fit_score: number | null;
    interest_tags: string[] | null;
  }>;
  contacts: Relation<{
    name: string | null;
    role: string | null;
    email: string;
    verification_status: string;
  }>;
  pipeline: Relation<{
    stage: string;
    next_followup_at: string | null;
  }>;
};

type EmailRow = {
  id: string;
  subject: string | null;
  body: string | null;
  step: number;
  scheduled_for: string | null;
  status: string;
  contacts: Relation<{
    name: string | null;
    companies: Relation<{ name: string }>;
  }>;
};

type EventRow = {
  type: string;
  data: Record<string, unknown> | null;
  created_at: string;
  companies: Relation<{ name: string }>;
};

function first<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function websiteDomain(website: string | null) {
  if (!website) return "No domain";
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website.replace(/^https?:\/\//, "").split("/")[0] || "No domain";
  }
}

export function getCrmDataMode(): DataMode {
  const serverIsConfigured = hasSupabaseConfig();
  const productionIsProtected = process.env.NODE_ENV !== "production" || env.authRequired;
  return serverIsConfigured && productionIsProtected ? "live" : "demo";
}

async function authorizeLiveRead() {
  if (getCrmDataMode() === "live" && env.authRequired) {
    await requireWorkspaceMember(["admin", "operator", "viewer"]);
  }
}

function mapCompany(row: CompanyRow): Company {
  const profile = first(row.company_profiles);
  const contact = first(row.contacts);
  const pipeline = first(row.pipeline);
  const domain = row.domain || websiteDomain(row.website);
  return {
    id: row.id,
    name: row.name,
    initials: getInitials(row.name),
    domain,
    country: row.country || "Unknown",
    segment: row.segment || "Unclassified",
    fitScore: profile?.fit_score ?? 0,
    stage: getPipelineStageLabel(pipeline?.stage || row.status),
    nextAction: pipeline?.next_followup_at ? `Follow up ${formatRelativeDate(pipeline.next_followup_at).toLowerCase()}` : "Review company",
    tags: profile?.interest_tags ?? [],
    contact: contact?.name || "No contact yet",
    contactRole: contact?.role || "Role not confirmed",
    email: contact?.email || "",
    summary: profile?.summary || "This company has not been profiled yet.",
  };
}

export async function listCompanies(): Promise<{ mode: DataMode; companies: Company[] }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, companies: [] };
  await authorizeLiveRead();

  const { data, error } = await createSupabaseAdmin()
    .from("companies")
    .select("id,name,website,domain,country,segment,status,company_profiles(summary,fit_score,interest_tags),contacts(name,role,email,verification_status),pipeline(stage,next_followup_at)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Unable to load companies: ${error.message}`);
  return { mode, companies: ((data ?? []) as unknown as CompanyRow[]).map(mapCompany) };
}

export async function getCompany(id: string) {
  const result = await listCompanies();
  return { mode: result.mode, company: result.companies.find((company) => company.id === id) ?? null };
}

function emailStatus(status: string): EmailDraft["status"] {
  if (status === "pending_approval") return "Needs approval";
  if (status === "scheduled" || status === "approved") return "Scheduled";
  return "Draft";
}

export async function listEmailDrafts(): Promise<{ mode: DataMode; emails: EmailDraft[] }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, emails: [] };
  await authorizeLiveRead();

  const { data, error } = await createSupabaseAdmin()
    .from("emails")
    .select("id,subject,body,step,scheduled_for,status,contacts(name,companies(name))")
    .in("status", ["draft", "pending_approval", "approved", "scheduled"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Unable to load email queue: ${error.message}`);

  const emails = ((data ?? []) as unknown as EmailRow[]).map((row) => {
    const contact = first(row.contacts);
    const company = first(contact?.companies ?? null);
    return {
      id: row.id,
      company: company?.name || "Unknown company",
      contact: contact?.name || "Unknown contact",
      subject: row.subject || "Untitled draft",
      preview: row.body || "No email body has been generated yet.",
      step: row.step,
      scheduledFor: formatRelativeDate(row.scheduled_for),
      status: emailStatus(row.status),
    };
  });
  return { mode, emails };
}

export async function listProducts(): Promise<{ mode: DataMode; products: Product[] }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, products: [] };
  await authorizeLiveRead();

  const { data, error } = await createSupabaseAdmin()
    .from("products")
    .select("sku,name,material,color,price,currency,moq,active,sheet_updated_at")
    .order("name")
    .limit(500);
  if (error) throw new Error(`Unable to load products: ${error.message}`);
  return {
    mode,
    products: (data ?? []).map((row) => ({
      sku: row.sku,
      name: row.name,
      material: row.material || "—",
      color: row.color || "—",
      price: row.price == null ? "—" : new Intl.NumberFormat("en", { style: "currency", currency: row.currency }).format(Number(row.price)),
      moq: row.moq,
      status: row.active ? "Active" : "Inactive",
      updatedAt: row.sheet_updated_at,
    })),
  };
}

function eventTone(type: string) {
  if (type.includes("reply") || type.includes("interest")) return "green";
  if (type.includes("catalog")) return "violet";
  if (type.includes("sync")) return "amber";
  return "blue";
}

export async function getDashboardData() {
  const companyResult = await listCompanies();
  if (companyResult.mode === "demo") {
    return {
      mode: companyResult.mode,
      companies: companyResult.companies,
      activity: [],
      emailQueueCount: 0,
      sentCount: 0,
      replyCount: 0,
      bigOrderCount: 0,
    };
  }

  const client = createSupabaseAdmin();
  const [eventsResult, queuedResult, sentResult, repliesResult, bigOrdersResult] = await Promise.all([
    client.from("events").select("type,data,created_at,companies(name)").order("created_at", { ascending: false }).limit(4),
    client.from("emails").select("id", { count: "exact", head: true }).in("status", ["draft", "pending_approval", "approved", "scheduled"]),
    client.from("emails").select("id", { count: "exact", head: true }).eq("status", "sent"),
    client.from("emails").select("id", { count: "exact", head: true }).eq("direction", "received"),
    client.from("pipeline").select("id", { count: "exact", head: true }).eq("stage", "big_order"),
  ]);
  if (eventsResult.error) throw new Error(`Unable to load activity: ${eventsResult.error.message}`);

  const activity: ActivityItem[] = ((eventsResult.data ?? []) as unknown as EventRow[]).map((row) => {
    const company = first(row.companies);
    const detail = typeof row.data?.summary === "string" ? row.data.summary : company?.name || "CRM event recorded";
    return { title: row.type.replaceAll("_", " "), detail, time: formatRelativeDate(row.created_at), tone: eventTone(row.type) };
  });

  return {
    mode: companyResult.mode,
    companies: companyResult.companies,
    activity,
    emailQueueCount: queuedResult.count ?? 0,
    sentCount: sentResult.count ?? 0,
    replyCount: repliesResult.count ?? 0,
    bigOrderCount: bigOrdersResult.count ?? 0,
  };
}
