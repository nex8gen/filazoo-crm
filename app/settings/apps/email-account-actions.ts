"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { SettingsActionState } from "../actions";

export async function setEmailConnectionActive(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember();
  const parsed = z.object({ id: z.string().uuid(), scope: z.enum(["personal", "workspace"]), operation: z.enum(["pause", "resume"]) })
    .safeParse(Object.fromEntries(["id", "scope", "operation"].map(key => [key, formData.get(key)])));
  if (!parsed.success) return { error: "Choose a valid email account and action." };
  const { id, scope, operation } = parsed.data;
  if (scope === "workspace" && viewer.role !== "admin") return { error: "Only an administrator can manage team email connections." };
  let query = createSupabaseAdmin().from("workspace_mailboxes")
    .update({ is_active: operation === "resume", updated_at: new Date().toISOString() }).eq("id", id).eq("type", scope);
  if (scope === "personal") query = query.eq("user_id", viewer.id);
  const { data, error } = await query.select("id").maybeSingle();
  if (error || !data) return { error: "The account could not be updated. Refresh and check your access." };
  revalidatePath("/settings", "layout");
  revalidatePath("/email");
  return { success: operation === "pause" ? "Connection paused. Saved credentials and email history are kept." : "Connection resumed." };
}
