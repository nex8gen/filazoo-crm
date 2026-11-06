import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { leadAssignmentSettingsSchema, type LeadAssignmentView } from "../lead-assignment-settings";

export async function getLeadAssignmentSettings(actorId: string): Promise<LeadAssignmentView> {
  const { data, error } = await createSupabaseAdmin().rpc("read_lead_assignment_settings", { p_actor_id: actorId });
  if (error || !data) throw new Error("Unable to load lead assignment controls. Check that the lead assignment migration is installed.");
  return data as LeadAssignmentView;
}

export async function saveLeadAssignmentSettings(input: unknown, actorId: string): Promise<LeadAssignmentView> {
  const policy = leadAssignmentSettingsSchema.parse(input);
  const { data, error } = await createSupabaseAdmin().rpc("save_lead_assignment_settings", { p_actor_id: actorId, p_policy: policy });
  if (error?.message === "Lead assignment settings changed") throw new Error("Lead assignment settings changed in another session. Reload before saving again.");
  if (error || !data) throw new Error("Unable to save lead assignment settings. Reload and check that the selected managers still belong to your team.");
  return data as LeadAssignmentView;
}
