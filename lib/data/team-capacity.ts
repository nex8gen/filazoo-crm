import "server-only";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth.ts";
import { createSupabaseControl } from "../supabase/control.ts";

const capacitySchema = z.object({
  plan: z.string(), active: z.boolean(), memberLimit: z.number().int().positive().nullable(),
  memberCount: z.number().int().nonnegative(), pendingCount: z.number().int().nonnegative(), canInvite: z.boolean(),
});
export type TeamCapacity = z.infer<typeof capacitySchema>;

export async function readTeamCapacity(viewer: WorkspaceViewer): Promise<TeamCapacity> {
  if (viewer.role !== "admin") throw new Error("Administrator access required.");
  const { data, error } = await createSupabaseControl(viewer.id).rpc("read_workspace_team_capacity", {
    p_actor_id: viewer.id, p_workspace_id: viewer.workspaceId,
  });
  const parsed = capacitySchema.safeParse(data);
  if (error || !parsed.success) throw new Error("Unable to check available user places. Refresh to try again.");
  return parsed.data;
}
