import { cache } from "react";
import { requireWorkspaceMember } from "../auth.ts";
import { currentWorkspaceContext } from "../workspace-context.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { businessHoursSchema, defaultWorkspaceSettings, timeZoneSchema, type WorkspaceSettings } from "../workspace-settings.ts";

// Only request-local deduplication; never share settings across users or tenants.
const readSettings = cache(async (workspaceId: string): Promise<WorkspaceSettings> => {
  if (workspaceId === "legacy") return defaultWorkspaceSettings;
  const { data, error } = await createSupabaseAdmin().from("workspaces").select("website,logo_data_url,timezone,business_hours").eq("id", workspaceId).single();
  if (error || !data) throw new Error("Unable to load workspace settings. Please refresh and try again.");
  return { website: data.website ?? "", logoDataUrl: data.logo_data_url ?? null,
    timezone: timeZoneSchema.parse(data.timezone), businessHours: businessHoursSchema.parse(data.business_hours) };
});

/** Call from an authenticated request or inside a trusted worker workspace context. */
export async function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  const context = currentWorkspaceContext();
  const workspaceId = context?.workspaceId ?? (await requireWorkspaceMember()).workspaceId;
  return readSettings(workspaceId);
}
