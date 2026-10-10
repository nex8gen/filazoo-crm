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
    if (error || !data.user) return { error: "The email or password is incorrect.", email };

    const { data: membership, error: membershipError } = await createSupabaseAdmin()
      .from("workspace_members")
      .select("role")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (membershipError || !membership) {
      await supabase.auth.signOut();
      return { error: "This account has not been invited to the Filazoo workspace.", email };
    }
  } catch {
    return { error: "Authentication is temporarily unavailable. Try again shortly.", email };
  }
  redirect(safeInternalPath(parsed.data.next));
}
