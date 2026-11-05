"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { getAuthProviders } from "@/lib/auth-providers";
import { signupDestination } from "@/lib/signup";
import { createClient } from "@/lib/supabase/server";

export async function socialSignIn(_state: { error?: string } | undefined, formData: FormData) {
  const provider = formData.get("provider");
  if (provider !== "google" && provider !== "apple") return { error: "Choose a supported sign-in provider." };
  let url: string | undefined;
  try {
    if (!(await getAuthProviders()).includes(provider)) return { error: "This sign-in option is currently unavailable. Continue with email." };
    const next = signupDestination(formData.get("next"));
    const result = await (await createClient()).auth.signInWithOAuth({ provider, options: { redirectTo: new URL(`/auth/callback?next=${encodeURIComponent(next)}`, env.NEXT_PUBLIC_APP_URL).toString() } });
    if (result.error || !result.data.url) return { error: "Unable to start sign-in. Try again or continue with email." };
    url = result.data.url;
  } catch { return { error: "Sign-in is temporarily unavailable. Continue with email." }; }
  redirect(url);
}
