"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getCompanyAnalysis } from "@/lib/data/company-analysis";
import { analysisTaskMarker, analysisToday, companyPurchaseAnalysis } from "@/lib/company-analysis";

export async function loadCompanyAnalysis(companyId: string) {
  return getCompanyAnalysis(companyId);
}

export async function createAnalysisFollowup(input: { companyId: string; productKey: string; currency: string; dueAt: string; requestId: string }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = z.object({ companyId: z.uuid(), productKey: z.string().min(1).max(2000), currency: z.string().length(3), dueAt: z.iso.datetime({ offset: true }), requestId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Choose a valid product and follow-up time." };
  if (Date.parse(parsed.data.dueAt) <= Date.now()) return { error: "Choose a future follow-up time." };
  const { companyId, productKey, currency, dueAt, requestId } = parsed.data;
  const data = await getCompanyAnalysis(companyId);
  const today = analysisToday(new Date(data.asOf));
  const reminder = companyPurchaseAnalysis(data, currency, { from: "", to: today }).reminders.find(item => item.key === productKey);
  if (!reminder) return { error: "This product's order history has changed. Refresh and try again." };
  const marker = analysisTaskMarker(productKey);
  const existing = data.tasks.find(task => task.notes === marker);
  if (existing) return { success: "An open follow-up already exists for this product.", task: existing };
  const db = createSupabaseAdmin();
  const { data: company, error: companyError } = await db.from("companies").select("id,pipeline(owner_id)").eq("id", companyId).single();
  if (companyError || !company) return { error: "The company could not be loaded. Please try again." };
  const pipeline = (Array.isArray(company.pipeline) ? company.pipeline[0] : company.pipeline) as { owner_id: string | null } | null;
  const labels = { receipt: "Confirm receipt and usage", fulfillment: "Check order fulfillment", restock: "Confirm replenishment needs", demand: "Review purchasing needs", history: "Discuss product needs", monitor: "Check product usage" };
  const { error } = await db.from("crm_tasks").upsert({
    id: requestId, company_id: companyId, assigned_to: pipeline?.owner_id || viewer.id, follows_company_owner: true,
    title: `${labels[reminder.kind]}: ${reminder.name}`.slice(0, 200),
    notes: marker, priority: "normal", due_at: dueAt,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) return { error: "The follow-up could not be created. Please try again." };
  const { data: task, error: readError } = await db.from("crm_tasks").select("id,notes,due_at").eq("id", requestId).eq("company_id", companyId).single();
  if (readError || !task) return { error: "The follow-up could not be confirmed. Refresh before retrying." };
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/pipeline");
  return { success: "Product follow-up created and assigned to the account owner.", task };
}
