"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { AuthField, AuthHeading, authButtonClass } from "@/components/auth-fields";
import { AuthSocialButtons } from "@/components/auth-social-buttons";
import type { AuthProvider } from "@/lib/auth-providers";
import { signup } from "./actions";

export function SignupForm({ next = "/workspaces/new", providers = [] }: { next?: string; providers?: AuthProvider[] }) {
  const [state, action, pending] = useActionState(signup, undefined);
  return <><AuthHeading title="Create an account">{next.startsWith("/join/") ? "Join your team and keep everything connected." : "Your customers. Your conversations. Your next chapter."}</AuthHeading>
    <AuthSocialButtons providers={providers} next={next} signup />
    <form action={action} className="space-y-5" aria-busy={pending}>
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-5 sm:grid-cols-2"><AuthField label="First name" id="firstName" name="firstName" autoComplete="given-name" placeholder="First name" defaultValue={state?.firstName} maxLength={40} required /><AuthField label="Last name" id="lastName" name="lastName" autoComplete="family-name" placeholder="Last name" defaultValue={state?.lastName} maxLength={40} required /></div>
      <AuthField label="Email" id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" defaultValue={state?.email} required />
      <AuthField label="Password" id="password" name="password" type="password" autoComplete="new-password" placeholder="Create a strong password" minLength={12} maxLength={72} aria-describedby="password-help" required />
      <p id="password-help" className="text-xs leading-5 text-black/55 dark:text-white/55">12–72 characters, with uppercase, lowercase, a number, and a symbol.</p>
      <div className="space-y-4 py-2 text-sm leading-6 text-black/60 dark:text-white/60"><label className="flex items-start gap-3"><input name="productUpdates" type="checkbox" className="mt-1.5 size-4 shrink-0 accent-primary" /><span>Email me about Filazoo product updates. Optional.</span></label><label className="flex items-start gap-3"><input name="terms" type="checkbox" required className="mt-1.5 size-4 shrink-0 accent-primary" /><span>I agree to the <Link href="/terms" target="_blank" className="font-medium text-primary underline underline-offset-4">Terms of Service</Link> and <Link href="/privacy" target="_blank" className="font-medium text-primary underline underline-offset-4">Privacy Policy</Link>.</span></label></div>
      {state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}
      <button type="submit" className={authButtonClass} disabled={pending}>{pending ? "Creating account…" : "Create account"}<ArrowRight className="size-4" /></button>
      <p className="pt-2 text-center text-sm text-black/60 dark:text-white/60">Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-primary underline underline-offset-4 hover:text-primary/80">Sign in</Link></p>
    </form></>;
}
