"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { segmentInputSchema } from "@/lib/segments";

export type SegmentActionState = { error?: string; success?: string };

export async function createSegment(_state: SegmentActionState, formData: FormData): Promise<SegmentActionState> {
  return saveSegment(formData, false);
}

export async function updateSegment(_state: SegmentActionState, formData: FormData): Promise<SegmentActionState> {
  return saveSegment(formData, true);
}

async function saveSegment(formData: FormData, updating: boolean): Promise<SegmentActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const segmentId = updating ? z.uuid().safeParse(formData.get("segmentId")) : null;
  if (updating && !segmentId?.success) return { error: "This segment could not be found." };
  let rules: unknown;
  try { rules = JSON.parse(String(formData.get("rules"))); }
  catch { return { error: "Choose valid segment rules." }; }
  const parsed = segmentInputSchema.safeParse({ name: formData.get("name"), description: formData.get("description"), rules });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the segment details." };
  const admin = createSupabaseAdmin();
  const selectedIds = [...new Set(parsed.data.rules.companyIds ?? [])];
  for (let offset = 0; offset < selectedIds.length; offset += 100) {
    const batch = selectedIds.slice(offset, offset + 100);
    const { data, error } = await admin.from("companies").select("id").in("id", batch).or("source.is.null,source.neq.sample_seed");
    if (error) return { error: "Unable to verify the selected companies. Please try again." };
    if (data?.length !== batch.length) return { error: "Some selected companies are no longer available. Refresh the page and choose again." };
  }
  const payload = { name: parsed.data.name, description: parsed.data.description, rules: parsed.data.rules };
  const result = segmentId?.success
    ? await admin.from("company_segments").update(payload).eq("id", segmentId.data).select("id").maybeSingle()
    : await admin.from("company_segments").insert({ ...payload, created_by: viewer.id });
  const { error } = result;
  if (error?.code === "23505") return { error: "A saved segment with this name already exists. Choose another name." };
  if (error) return { error: "Unable to create the segment. Please try again." };
  if (segmentId?.success && !result.data) return { error: "This segment could not be found." };
  revalidatePath("/segments");
  if (segmentId?.success) revalidatePath("/companies");
  return { success: updating ? "Segment updated." : "Segment created." };
}
