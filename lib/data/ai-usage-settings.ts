import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { aiUsageSettingsSchema, type AiUsageSettingsView } from "../ai/usage-settings";

export async function getAiUsageSettings(actorId: string): Promise<AiUsageSettingsView> {
  const { data, error } = await createSupabaseAdmin().rpc("read_ai_usage_settings", { p_actor_id: actorId });
  if (error || !data) throw new Error("Unable to load AI usage settings. Check the AI usage controls migration.");
  return data as AiUsageSettingsView;
}

export async function saveAiUsageSettings(input: unknown, actorId: string): Promise<AiUsageSettingsView> {
  const parsed = aiUsageSettingsSchema.parse(input);
  const { data, error } = await createSupabaseAdmin().rpc("save_ai_usage_settings", { p_actor_id: actorId, p_revision: parsed.revision, p_policy: parsed });
  if (error?.code === "P0001" && error.message === "AI usage settings changed") throw new Error("AI usage settings changed in another session. Reload this page before saving again.");
  if (error || !data) throw new Error("Unable to save AI usage settings. Reload and check that all selected users are active members.");
  return data as AiUsageSettingsView;
}
