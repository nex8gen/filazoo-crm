import Link from "next/link";
import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { AuthHeading } from "@/components/auth-fields";

export const metadata: Metadata = { title: "Authentication error" };

export default function AuthErrorPage() {
  return (
    <AuthShell>
      <CircleAlert className="mb-6 size-10" /><AuthHeading title="Let's get you a new link">This link may have expired or already been used. Choose the next step for your account.</AuthHeading><div className="flex flex-col gap-3"><Button nativeButton={false} render={<Link href="/signup/verify" />}>Resend verification email</Button><Button nativeButton={false} variant="outline" render={<Link href="/forgot-password" />}>Reset my password</Button><Button nativeButton={false} variant="ghost" render={<Link href="/login" />}>Back to sign in</Button></div><p className="mt-6 text-sm text-black/60 dark:text-white/60">For a team invitation, ask your workspace administrator for a new invitation link.</p>
    </AuthShell>
  );
}
