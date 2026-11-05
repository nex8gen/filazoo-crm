"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { pendingSignupCookie, pendingSignupOptions, readPendingSignup, signupDestination, signupSchema } from "@/lib/signup";

export type SignupState = { error?: string; email?: string; firstName?: string; lastName?: string } | undefined;
export async function signup(_state: SignupState, formData: FormData): Promise<SignupState> {
  const next = signupDestination(formData.get("next"));
  const values = { firstName: String(formData.get("firstName") || ""), lastName: String(formData.get("lastName") || ""), email: String(formData.get("email") || "") };
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...values, error: parsed.error.issues[0]?.message || "Check your account details." };
  let signedIn = false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password,
      options: { emailRedirectTo: new URL(`/auth/callback?next=${encodeURIComponent(next)}`, env.NEXT_PUBLIC_APP_URL).toString(),
        data: { display_name: `${parsed.data.firstName} ${parsed.data.lastName}`, first_name: parsed.data.firstName, last_name: parsed.data.lastName,
          terms_accepted_at: new Date().toISOString(), terms_version: "2026-11-05", product_updates: formData.get("productUpdates") === "on" } } });
    if (error) return { ...values, error: error.status === 429 ? "Too many attempts. Please try again later." : "We could not create your account. Try again, or sign in if you already have an account." };
    signedIn = Boolean(data.session);
    (await cookies()).set(pendingSignupCookie, JSON.stringify({ email: parsed.data.email, next }), pendingSignupOptions);
  } catch { return { ...values, error: "Signup is temporarily unavailable. Please try again shortly." }; }
  if (signedIn) redirect(next);
  redirect("/signup/verify");
}

export async function resendVerification(_state: { error?: string; success?: string } | undefined, formData?: FormData) {
  void _state;
  const pending = readPendingSignup((await cookies()).get(pendingSignupCookie)?.value);
  if (!pending) return { error: "Start sign-up again to request a verification email." };
  const next = signupDestination(formData?.get("next") || pending.next);
  try {
    const { error } = await (await createClient()).auth.resend({ type: "signup", email: pending.email,
      options: { emailRedirectTo: new URL(`/auth/callback?next=${encodeURIComponent(next)}`, env.NEXT_PUBLIC_APP_URL).toString() } });
    if (error) return { error: error.status === 429 ? "Please wait a minute before requesting another email." : "Unable to resend right now. Try again shortly." };
    return { success: "If your account needs verification, a new code is on its way. Check your spam folder too." };
  } catch { return { error: "Email verification is temporarily unavailable. Try again shortly." }; }
}
