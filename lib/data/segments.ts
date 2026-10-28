import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { getCrmDataMode } from "./crm.ts";
import { segmentRulesSchema, type SavedSegment } from "../segments.ts";

export async function listSavedSegments(): Promise<SavedSegment[]> {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  if (getCrmDataMode() !== "live") return [];
  const segments: SavedSegment[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await createSupabaseAdmin().from("company_segments")
      .select("id,name,description,rules,created_at").order("id").range(offset, offset + 999);
    if (error) throw new Error("Unable to load saved segments. Please try again.");
    for (const row of data ?? []) segments.push({ id: row.id, name: row.name, description: row.description, rules: segmentRulesSchema.parse(row.rules), createdAt: row.created_at });
    if (!data || data.length < 1000) break;
  }
  return segments;
}

export async function getSavedSegment(id: string): Promise<SavedSegment | null> {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { data, error } = await createSupabaseAdmin().from("company_segments")
    .select("id,name,description,rules,created_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to load this segment. Please try again.");
  return data ? { id: data.id, name: data.name, description: data.description, rules: segmentRulesSchema.parse(data.rules), createdAt: data.created_at } : null;
}
