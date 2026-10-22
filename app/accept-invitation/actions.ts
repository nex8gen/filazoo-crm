"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { passwordRequirementsError, passwordSchema } from "@/lib/password";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AcceptInvitationState = { error?: string } | undefined;

const schema = z.object({
  displayName: z.string().trim().min(2, "Enter your full name.").max(80),
  password: passwordSchema,
  confirmation: z.string(),
}).refine((value) => value.password === value.confirmation, {
  message: "The passwords do not match.",
  path: ["confirmation"],
});

export async function acceptInvitation(_state: AcceptInvitationState, formData: FormData): Promise<AcceptInvitationState> {
  const parsed = schema.safeParse({
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) return { error: passwordRequirementsError(parsed.error) };

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return { error: "Open this page from a valid invitation link." };

  const admin = createSupabaseAdmin();
  const { data: membership, error: membershipError } = await admin
    .from("workspace_members")
    .select("user_id,activated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError || !membership) return { error: "This invitation does not include workspace access." };
  if (membership.activated_at) return { error: "This account is already active. Sign in instead." };

  const { error: passwordError } = await supabase.auth.updateUser({
    password: parsed.data.password,
    data: { display_name: parsed.data.displayName },
  });
  if (passwordError) return { error: passwordError.message };

  const activatedAt = new Date().toISOString();
  const { error: activationError } = await admin
    .from("workspace_members")
    .update({ display_name: parsed.data.displayName, activated_at: activatedAt, updated_at: activatedAt })
    .eq("user_id", userId)
    .is("activated_at", null);
  if (activationError) return { error: "Your password was saved, but the workspace account could not be activated. Try again." };

  await supabase.auth.signOut();
  redirect("/login?message=Account%20setup%20complete.%20Sign%20in%20with%20your%20new%20password.");
}
