"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string; email?: string } | undefined;

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

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
    if (error) {
      reportLoginFailure("sign-in", error);
      return { error: error.status === 400 || error.status === 422
      ? "The email or password is incorrect."
      : "Authentication is temporarily unavailable. Try again shortly.", email };
    }
    if (!data.user) return { error: "The email or password is incorrect.", email };

    const { data: membership, error: membershipError } = await createSupabaseAdmin()
      .from("workspace_members")
      .select("role,activated_at")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (membershipError) {
      reportLoginFailure("membership", membershipError);
      return { error: "Authentication is temporarily unavailable. Try again shortly.", email };
    }
    if (!membership) {
      await supabase.auth.signOut();
      return { error: "This account has not been invited to the Filazoo workspace.", email };
    }
    if (!membership.activated_at) {
      await supabase.auth.signOut();
      return { error: "Finish setting up this account from the invitation email before signing in.", email };
    }
  } catch (error) {
    reportLoginFailure("unexpected", error);
    return { error: "Authentication is temporarily unavailable. Try again shortly.", email };
  }
  redirect(safeInternalPath(parsed.data.next));
}
