"use server";

import { z } from "zod";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type ForgotPasswordState = { error?: string; success?: string; email?: string } | undefined;

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

export async function requestPasswordReset(_state: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")).trim() : "";
  const parsed = schema.safeParse({ email });
  if (!parsed.success) return { error: "Enter a valid email address.", email };

  try {
    const supabase = await createClient();
    const redirectTo = new URL("/auth/callback?next=/update-password", env.NEXT_PUBLIC_APP_URL).toString();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });
  } catch {
    return { error: "Password recovery is temporarily unavailable. Try again shortly.", email };
  }

  return { success: "If this email belongs to a workspace user, a recovery link is on its way.", email };
}
