import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = { title: "Update password" };

export default function UpdatePasswordPage() {
  return <AuthShell footer="Secure account recovery"><UpdatePasswordForm /></AuthShell>;
}
