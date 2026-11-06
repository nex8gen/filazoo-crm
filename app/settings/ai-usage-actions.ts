"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { aiUsageSettingsSchema } from "@/lib/ai/usage-settings";
import { saveAiUsageSettings } from "@/lib/data/ai-usage-settings";

export async function updateAiUsageSettings(input: unknown) {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = aiUsageSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Check your spending limits. Amounts must be nonnegative and the monthly budget must be at least $0.01." };
  return withWorkspaceViewer(viewer, async () => {
    try {
      const saved = await saveAiUsageSettings(parsed.data, viewer.id);
      revalidatePath("/settings/ai");
      return { saved };
    } catch (error) { return { error: error instanceof Error ? error.message : "Unable to save AI usage settings." }; }
  });
}
