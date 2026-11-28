"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { AuthField, AuthHeading, authButtonClass } from "@/components/auth-fields";
import { AuthSocialButtons } from "@/components/auth-social-buttons";
import type { AuthProvider } from "@/lib/auth-providers";
import { signup } from "./actions";

export function SignupForm({ next = "/subscribe", providers = [] }: { next?: string; providers?: AuthProvider[] }) {
  const [state, action, pending] = useActionState(signup, undefined);
  const accountNext = state?.next || (next === "/subscribe" ? "/workspaces/new" : next);
  const accountQuery = new URLSearchParams({ next: accountNext, ...(state?.email ? { email: state.email } : {}) }).toString();
  return <><AuthHeading title="Create an account">{next.startsWith("/join/") ? "Join your team." : null}</AuthHeading>
    <AuthSocialButtons providers={providers} next={next} signup />
    <form action={action} className="space-y-[var(--auth-form-gap,1.25rem)]" aria-busy={pending}>
      <input type="hidden" name="next" value={next} />
      <div className="grid grid-cols-2 gap-3"><AuthField label="First name" id="firstName" name="firstName" autoComplete="given-name" placeholder="First name" defaultValue={state?.firstName} maxLength={40} required /><AuthField label="Last name" id="lastName" name="lastName" autoComplete="family-name" placeholder="Last name" defaultValue={state?.lastName} maxLength={40} required /></div>
      <AuthField label="Company name" id="companyName" name="companyName" autoComplete="organization" placeholder="e.g. Acme Studio" defaultValue={state?.companyName} minLength={2} maxLength={80} required />
      <AuthField label="Email" id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" defaultValue={state?.email} required />
      <div className="space-y-1.5"><AuthField label="Password" id="password" name="password" type="password" autoComplete="new-password" placeholder="Create a strong password" minLength={12} maxLength={72} aria-describedby="password-help" required />
      <p id="password-help" className="text-xs leading-5 text-black/55 dark:text-white/55">12–72 characters: upper & lowercase, number & symbol.</p></div>
      <div className="space-y-2 text-xs leading-5 text-black/60 dark:text-white/60"><label className="flex items-start gap-2"><input name="productUpdates" type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" /><span>Send me product updates (optional).</span></label><label className="flex items-start gap-2"><input name="terms" type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-primary" /><span>I agree to the <Link href="/terms" target="_blank" className="font-medium text-primary underline underline-offset-4">Terms of Service</Link> and <Link href="/privacy" target="_blank" className="font-medium text-primary underline underline-offset-4">Privacy Policy</Link>.</span></label></div>
      {state?.error ? <NotificationToast><p>{state.error}</p>{state.existingAccount ? <div className="mt-3 flex flex-wrap gap-4"><Link href={`/login?${accountQuery}`} className="font-medium underline underline-offset-4">Sign in</Link><Link href={`/forgot-password?${accountQuery}`} className="font-medium underline underline-offset-4">Reset password</Link></div> : null}</NotificationToast> : null}
      <button type="submit" className={authButtonClass} disabled={pending}>{pending ? "Creating account…" : "Create account"}<ArrowRight className="size-4" /></button>
      <p className="text-center text-sm text-black/60 dark:text-white/60">Already have an account? <Link href={`/login?${accountQuery}`} className="font-medium text-primary underline underline-offset-4 hover:text-primary/80">Sign in</Link></p>
    </form></>;
}
