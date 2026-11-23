import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { UpdatePasswordForm } from "./update-password-form";
import { loginDestination } from "@/lib/login-destination";

export const metadata: Metadata = { title: "Update password" };
export const instant = false;

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AuthShell footer="Secure account recovery"><UpdatePasswordForm next={loginDestination(next)} /></AuthShell>;
}
