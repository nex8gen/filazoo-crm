"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { env } from "@/lib/env";
import { loginDestination } from "@/lib/login-destination";
import { createClient } from "@/lib/supabase/server";

const pendingCookie = "filazoo-oauth-email";
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 3600 };
export type EmailState = { error?: string; success?: string; sent?: boolean } | undefined;

export async function switchAccount() {
  await requireViewer();
  await (await createClient()).auth.signOut();
  redirect("/login");
}

export async function sendAccountEmail(_state: EmailState, form: FormData): Promise<EmailState> {
  const viewer = await requireViewer();
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user || user.id !== viewer.id) return { error: "Please sign in again." };
  // This form completes a new email-less identity; it cannot replace a verified email.
  if (user.email && user.email_confirmed_at) redirect(loginDestination(form.get("next")));
  const email = z.string().trim().toLowerCase().email().max(254).safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  const next = loginDestination(form.get("next"));
  const { error } = await client.auth.updateUser({ email: email.data }, {
    emailRedirectTo: new URL(`/auth/confirm?next=${encodeURIComponent(next)}`, env.NEXT_PUBLIC_APP_URL).toString(),
  });
  if (error) return { error: error.status === 429 ? "Please wait a minute before requesting another email." : "Unable to verify this address. If you already have an account, sign in with email and connect Alipay in your profile." };
  (await cookies()).set(pendingCookie, JSON.stringify({ email: email.data, userId: viewer.id, expires: Date.now() + 3600_000 }), cookieOptions);
  return { sent: true, success: "Check your email for the verification code." };
}

export async function confirmAccountEmail(_state: EmailState, form: FormData): Promise<EmailState> {
  const viewer = await requireViewer();
  const store = await cookies();
  let pending: { email?: string; userId?: string; expires?: number };
  try { pending = JSON.parse(store.get(pendingCookie)?.value || "null"); } catch { return { error: "Request a new verification code." }; }
  if (!pending || pending.userId !== viewer.id || !pending.email || !pending.expires || pending.expires < Date.now()) return { error: "Request a new verification code." };
  const code = z.string().trim().regex(/^\d{6,10}$/).safeParse(form.get("code"));
  if (!code.success) return { error: "Enter the verification code from your email." };
  const client = await createClient();
  const { data, error } = await client.auth.verifyOtp({ email: pending.email, token: code.data, type: "email_change" });
  if (error || !data.user || data.user.id !== viewer.id || data.user.email?.toLowerCase() !== pending.email || !data.user.email_confirmed_at) {
    if (data.user && data.user.id !== viewer.id) await client.auth.signOut();
    return { error: "That code is invalid or has expired. Request a new code." };
  }
  store.set(pendingCookie, "", { ...cookieOptions, maxAge: 0 });
  redirect(loginDestination(form.get("next")));
}
