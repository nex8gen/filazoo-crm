"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { userPreferencesSchema } from "@/lib/user-preferences";
import { revokeDeviceSessions } from "./security-actions";

export async function saveUserPreferences(input: unknown) {
  await requireWorkspaceMember();
  const parsed = userPreferencesSchema.strict().safeParse(input);
  if (!parsed.success) return { error: "Check your preferences. The signature must be at most 2,000 characters." };
  try {
    const client = await createClient();
    const { error } = await client.auth.updateUser({ data: { crm_preferences: parsed.data } });
    if (error) return { error: "Unable to save preferences. Please try again." };
    revalidatePath("/", "layout");
    return { preferences: parsed.data };
  } catch {
    return { error: "Unable to save preferences. Please try again." };
  }
}

export async function signOutOtherSessions() {
  return revokeDeviceSessions({ scope: "others" });
}
