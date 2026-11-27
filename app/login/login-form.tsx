"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AuthField, authButtonClass } from "@/components/auth-fields";
import { AuthSocialButtons } from "@/components/auth-social-buttons";
import { NotificationToast } from "@/components/ui/notification-toast";
import type { AuthProvider } from "@/lib/auth-providers";
import { login } from "./actions";
import { PasskeySignIn } from "./passkey-sign-in";

export function LoginForm({ next = "/", message, email, providers = [], passkeysEnabled = false }: { next?: string; message?: string; email?: string; providers?: AuthProvider[]; passkeysEnabled?: boolean }) {
  const [state, action, pending] = useActionState(login, undefined);
  const recoveryQuery = new URLSearchParams({ next, email: state?.email ?? email ?? "" });

  return (
    <>
      <h1 className="mb-[var(--auth-heading-gap,1.5rem)] text-center text-3xl font-medium leading-tight tracking-[-0.025em]">Welcome back</h1>
      <form className="space-y-[var(--auth-form-gap,1.5rem)]" action={action}>
        <input type="hidden" name="next" value={next} />
        <AuthField label="Email" id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" defaultValue={state?.email ?? email} required />
        <div className="relative">
          <AuthField label="Password" id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required />
          <Link href={`/forgot-password?${recoveryQuery}`} className="absolute right-0 top-0 text-xs leading-5 text-primary hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4">Forgot password?</Link>
        </div>
        {message && !state?.error ? <NotificationToast tone="success">{message}</NotificationToast> : null}
        {state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}
        {state?.needsVerification ? <Link href={`/signup/verify?next=${encodeURIComponent(next)}`} className="block text-sm underline underline-offset-4">Verify your email or request a new link</Link> : null}
        <button className={authButtonClass} type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
      {passkeysEnabled ? <PasskeySignIn next={next} /> : null}
      <AuthSocialButtons providers={providers} next={next} layout="tiles" />
      <p className="mt-[var(--auth-signup-gap,4rem)] flex flex-wrap items-center justify-center gap-2 text-center text-xs text-black/60 dark:text-white/60">Don&apos;t have a NewAI account? <Link href={`/signup?next=${encodeURIComponent(next === "/" || next === "/workspaces" ? "/workspaces/new" : next)}`} className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4">Let&apos;s get started</Link></p>
    </>
  );
}
