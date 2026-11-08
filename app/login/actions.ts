"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { preferredStartPage } from "@/lib/user-preferences";

export type LoginState = { error?: string; email?: string; needsVerification?: boolean } | undefined;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  next: z.string().startsWith("/").default("/"),
});

function reportLoginFailure(stage: "sign-in" | "membership" | "unexpected", error: unknown) {
  const failure = error as { status?: number; code?: unknown; cause?: { code?: unknown } } | null;
  const code = failure?.cause?.code ?? failure?.code;
  // Never log credentials, provider response bodies or raw exception messages.
  console.error("CRM authentication failed", {
    stage,
    status: typeof failure?.status === "number" ? failure.status : undefined,
    code: typeof code === "string" && /^[a-zA-Z0-9_]{1,64}$/.test(code) ? code : "unknown",
  });
}

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || "/",
  });
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")).trim() : "";
  if (!parsed.success) return { error: "Enter a valid email and a password of at least 8 characters.", email };
  let destination = "/";

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
    if (error) {
      reportLoginFailure("sign-in", error);
      if (error.code === "email_not_confirmed") return { error: "Verify your email before signing in. Enter the code from your email, or request a new code.", email, needsVerification: true };
      return { error: error.status === 400 || error.status === 422
      ? "The email or password is incorrect."
      : "Authentication is temporarily unavailable. Try again shortly.", email };
    }
    if (!data.user) return { error: "The email or password is incorrect.", email };
    destination = safeInternalPath(parsed.data.next);
    // Explicit deep links take priority. The start page is a display preference,
    // and destination routes still enforce workspace membership and roles.
    if (destination === "/") destination = preferredStartPage(data.user.user_metadata?.crm_preferences);

  } catch (error) {
    reportLoginFailure("unexpected", error);
    return { error: "Authentication is temporarily unavailable. Try again shortly.", email };
  }
  redirect(destination);
}
