"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string } | undefined;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  next: z.string().startsWith("/").default("/"),
});

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || "/",
  });
  if (!parsed.success) return { error: "Enter a valid email and a password of at least 8 characters." };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
    if (error) return { error: "The email or password is incorrect." };
  } catch {
    return { error: "Supabase authentication is not configured yet." };
  }
  redirect(safeInternalPath(parsed.data.next));
}
