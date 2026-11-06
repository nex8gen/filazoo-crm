import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MailCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading } from "@/components/auth-fields";
import { getViewer } from "@/lib/auth";
import { pendingSignupCookie, readPendingSignup, signupDestination } from "@/lib/signup";
import { VerificationForm } from "./verification-form";

export const metadata = { title: "Verify your email", robots: { index: false, follow: false } };
export const instant = false;

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const pending = readPendingSignup((await cookies()).get(pendingSignupCookie)?.value);
  const next = signupDestination((await searchParams).next || pending?.next);
  if (await getViewer()) redirect(next);
  return <AuthShell step={2}><MailCheck className="mb-6 size-10 text-primary" /><AuthHeading title="Verify your email">Enter the verification code from your email to finish setting up your account.</AuthHeading>
    {pending ? <p className="mb-6 break-words text-sm text-black/60 dark:text-white/60">We sent a verification code to <strong className="text-black dark:text-white">{pending.email}</strong>.</p> : null}
    <VerificationForm email={pending?.email} next={next} />
    <div className="mt-7 flex flex-wrap justify-between gap-4 text-sm"><Link href={`/login?next=${encodeURIComponent(next)}`} className="text-primary underline underline-offset-4">Already verified? Sign in</Link><Link href={`/signup?next=${encodeURIComponent(next)}`} className="text-primary underline underline-offset-4">Use another email</Link></div>
  </AuthShell>;
}
