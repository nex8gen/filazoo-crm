"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { passwordRequirementsError, passwordSchema } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";
import { loginDestination } from "@/lib/login-destination";
import { readAccountSecurity } from "@/lib/account-security-server";

export type UpdatePasswordState = { error?: string } | undefined;

const schema = z.object({ password: passwordSchema, confirmation: z.string() }).refine((value) => value.password === value.confirmation, { message: "The passwords do not match.", path: ["confirmation"] });

export async function updatePassword(_state: UpdatePasswordState, formData: FormData): Promise<UpdatePasswordState> {
  const parsed = schema.safeParse({ password: formData.get("password"), confirmation: formData.get("confirmation") });
  if (!parsed.success) return { error: passwordRequirementsError(parsed.error) };

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) return { error: "Open this page from a valid recovery link or sign in again." };

  const security = await readAccountSecurity().catch(() => null);
  if (!security) return { error: "Unable to verify your account session. Open a new recovery link or sign in again." };
  if (security.requiresMfa) redirect(`/auth/mfa?next=${encodeURIComponent("/update-password")}`);

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };

  await supabase.auth.signOut();
  redirect(`/login?${new URLSearchParams({ next: loginDestination(formData.get("next")), message: "Password updated. Sign in with your new password." })}`);
}
