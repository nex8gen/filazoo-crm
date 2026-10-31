"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceMember } from "@/lib/auth";
import { aiPolicySchema } from "@/lib/ai-policy";
import { saveAiSettings } from "@/lib/data/ai-settings";
import { z } from "zod";

export async function updateAiSettings(input: unknown) {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = z.object({ policy: aiPolicySchema, revision: z.number().int().min(0) }).strict().safeParse(input);
  if (!parsed.success) return { error: "Check the AI settings and keep each instruction under 4,000 characters." };
  try {
    const saved = await saveAiSettings(parsed.data.policy, parsed.data.revision, viewer.id);
    revalidatePath("/settings/ai");
    return { saved };
  } catch (error) { return { error: error instanceof Error ? error.message : "Unable to save AI settings." }; }
}
