"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { AuthField, AuthHeading, authButtonClass } from "@/components/auth-fields";
import { AuthSocialButtons } from "@/components/auth-social-buttons";
import type { AuthProvider } from "@/lib/auth-providers";
import { login } from "./actions";

export function LoginForm({ next = "/workspaces", message, providers = [] }: { next?: string; message?: string; providers?: AuthProvider[] }) {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <><AuthHeading title="Welcome back">Sign in to your account. Pick up where you left off.</AuthHeading>
      <AuthSocialButtons providers={providers} next={next} />
        <form className="space-y-4" action={action}>
          <input type="hidden" name="next" value={next} />
          <AuthField label="Email" id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" defaultValue={state?.email} required />
          <AuthField label="Password" id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required />
          <div className="flex justify-end"><Link href="/forgot-password" className="text-sm text-primary underline underline-offset-4 hover:text-primary/80">Forgot password?</Link></div>
          {message && !state?.error ? <p role="status" className="text-xs text-primary">{message}</p> : null}
          {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
          {state?.needsVerification ? <Link href={`/signup/verify?next=${encodeURIComponent(next)}`} className="block text-sm underline underline-offset-4">Verify your email or request a new link</Link> : null}
          <button className={authButtonClass} type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}<ArrowRight className="size-4" /></button>
          <p className="pt-3 text-center text-sm text-black/60 dark:text-white/60">New here? <Link href={`/signup?next=${encodeURIComponent(next === "/workspaces" ? "/workspaces/new" : next)}`} className="font-medium text-primary underline underline-offset-4 hover:text-primary/80">Create an account</Link></p>
        </form>
    </>
  );
}
