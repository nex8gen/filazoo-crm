"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { passwordRequirementsError, passwordSchema } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";

export type UpdatePasswordState = { error?: string } | undefined;

const schema = z.object({ password: passwordSchema, confirmation: z.string() }).refine((value) => value.password === value.confirmation, { message: "The passwords do not match.", path: ["confirmation"] });

export async function updatePassword(_state: UpdatePasswordState, formData: FormData): Promise<UpdatePasswordState> {
  const parsed = schema.safeParse({ password: formData.get("password"), confirmation: formData.get("confirmation") });
  if (!parsed.success) return { error: passwordRequirementsError(parsed.error) };

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) return { error: "Open this page from a valid recovery link or sign in again." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };

  await supabase.auth.signOut();
  redirect("/login?message=Password%20updated.%20Sign%20in%20with%20your%20new%20password.");
}
