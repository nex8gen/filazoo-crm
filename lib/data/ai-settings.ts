import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { hasSupabaseConfig } from "../env.ts";
import { aiPolicySchema, defaultAiPolicy, assertAiFeature, assertAiData, AiPolicyError, type AiPolicy, type AiFeature, type AiData, type AiAction } from "../ai-policy.ts";

export type AiSettingsView = { policy: AiPolicy; revision: number; updatedAt: string | null };
// No process cache: workers and saved proposals must see newly revoked access.
export async function getAiSettings(): Promise<AiSettingsView> {
  if (!hasSupabaseConfig()) throw new Error("AI access settings cannot be verified because the database is not configured.");
  const { data, error } = await createSupabaseAdmin().from("workspace_ai_settings").select("policy,revision,updated_at").eq("singleton", true).maybeSingle();
  if (error) throw new Error("Unable to load AI access settings. Check the workspace AI settings migration. AI is paused until settings can be verified.");
  return { policy: data ? aiPolicySchema.parse(data.policy) : defaultAiPolicy(), revision: data?.revision ?? 0, updatedAt: data?.updated_at ?? null };
}
export async function requireAiFeature(feature: AiFeature, ...data: AiData[]) {
  const { policy } = await getAiSettings();
  assertAiFeature(policy, feature);
  assertAiData(policy, ...data);
  return policy;
}
export async function requireAiData(...data: AiData[]) {
  const { policy } = await getAiSettings();
  if (!policy.enabled) throw new Error("AI is disabled in Settings → AI access & behavior.");
  assertAiData(policy, ...data);
  return policy;
}
export async function requireAiAutomation(actions: AiAction[] = [], data: AiData[] = []) {
  const policy = await requireAiFeature("automation", ...data);
  if (actions.some(action => action === "sending" || action === "emailDrafts" || action === "tagging")) assertAiFeature(policy, "email");
  for (const action of actions) if (policy.actions[action] !== "auto") throw new AiPolicyError("Workspace AI settings require a person to review this work. Enable automatic permission for the required action before resuming background AI.");
  return policy;
}
export async function saveAiSettings(policy: AiPolicy, revision: number, userId: string) {
  const db = createSupabaseAdmin();
  const row = { policy: aiPolicySchema.parse(policy), revision: revision + 1, updated_by: userId, updated_at: new Date().toISOString() };
  const result = revision === 0
    ? await db.from("workspace_ai_settings").insert({ singleton: true, ...row }).select("revision").maybeSingle()
    : await db.from("workspace_ai_settings").update(row).eq("singleton", true).eq("revision", revision).select("revision").maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data)) throw new Error("AI settings changed in another session. Reload this page before saving again.");
  if (result.error) throw new Error("Unable to save AI settings. Your changes have not been applied.");
  return { policy: row.policy, revision: row.revision, updatedAt: row.updated_at };
}
