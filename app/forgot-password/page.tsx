import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";
import { loginDestination } from "@/lib/login-destination";

export const metadata: Metadata = { title: "Reset password" };
export const instant = false;

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  return <AuthShell><ForgotPasswordForm next={loginDestination(next)} email={email} /></AuthShell>;
}
