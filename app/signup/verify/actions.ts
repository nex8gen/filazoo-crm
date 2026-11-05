"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { pendingSignupCookie, pendingSignupOptions, readPendingSignup, signupDestination } from "@/lib/signup";

export type VerificationState = { error?: string; success?: string } | undefined;

export async function verifySignupCode(_state: VerificationState, formData: FormData): Promise<VerificationState> {
  const cookieStore = await cookies();
  const pending = readPendingSignup(cookieStore.get(pendingSignupCookie)?.value);
  const parsed = z.object({ email: z.string().trim().toLowerCase().email("Enter your account email."),
    code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your email.") }).safeParse({
    email: pending?.email || formData.get("email"), code: formData.get("code"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const next = signupDestination(formData.get("next") || pending?.next);
  try {
    const { data, error } = await (await createClient()).auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: "email" });
    if (error?.status === 429) return { error: "Too many attempts. Please wait a minute before trying again." };
    if (error || !data.session || !data.user) return { error: "That code is invalid or has expired. Try again, or request a new code." };
    cookieStore.set(pendingSignupCookie, "", { ...pendingSignupOptions, maxAge: 0 });
  } catch { return { error: "Verification is temporarily unavailable. Please try again shortly." }; }
  redirect(next);
}

export async function requestVerification(_state: { error?: string; success?: string } | undefined, formData: FormData) {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  const next = signupDestination(formData.get("next"));
  try {
    const { error } = await (await createClient()).auth.resend({ type: "signup", email: email.data,
      options: { emailRedirectTo: new URL(`/auth/callback?next=${encodeURIComponent(next)}`, env.NEXT_PUBLIC_APP_URL).toString() } });
    if (error?.status === 429) return { error: "Please wait a minute before requesting another email." };
    if (error && error.code !== "user_not_found" && error.code !== "email_already_confirmed") return { error: "Unable to resend right now. Try again shortly." };
    (await cookies()).set(pendingSignupCookie, JSON.stringify({ email: email.data, next }), pendingSignupOptions);
    return { success: "If your account needs verification, a new code is on its way. Check your spam folder too." };
  } catch { return { error: "Email verification is temporarily unavailable. Try again shortly." }; }
}
