"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { leadAssignmentSettingsSchema } from "@/lib/lead-assignment-settings";
import { saveLeadAssignmentSettings } from "@/lib/data/lead-assignment-settings";

export async function updateLeadAssignmentSettings(input: unknown) {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = leadAssignmentSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter whole-number capacities from 1 to 1,000,000, or leave them blank for unlimited." };
  return withWorkspaceViewer(viewer, async () => {
    try {
      const saved = await saveLeadAssignmentSettings(parsed.data, viewer.id);
      revalidatePath("/settings/advanced");
      revalidatePath("/settings/team");
      return { saved };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to save lead assignment settings." };
    }
  });
}
