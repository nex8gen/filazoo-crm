"use client";

import { useActionState, useEffect, useState } from "react";
import { resendVerification } from "../actions";
import { AuthField, authButtonClass } from "@/components/auth-fields";
import { requestVerification, verifySignupCode, type VerificationState } from "./actions";

export function VerificationForm({ email, next = "/workspaces/new" }: { email?: string; next?: string }) {
  const [cooldown, setCooldown] = useState(email ? 60 : 0);
  const coolingDown = cooldown > 0;
  const [state, action, pending] = useActionState(verifySignupCode, undefined);
  const [sendState, sendAction, sending] = useActionState(async (previous: VerificationState, data: FormData) => {
    const result = email ? await resendVerification(previous, data) : await requestVerification(previous, data);
    if (result.success) setCooldown(60);
    return result;
  }, undefined);
  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  return <form action={action} className="space-y-5" aria-busy={pending || sending}>
    <input type="hidden" name="next" value={next} />
    {!email ? <AuthField label="Email" id="verification-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required /> : null}
    <div className="space-y-2"><label htmlFor="verification-code" className="text-sm font-medium">Verification code</label><input id="verification-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} placeholder="00000000" aria-describedby="code-help" required className="h-16 w-full rounded-[10px] border border-input bg-transparent px-4 text-center font-mono text-2xl tracking-[0.25em] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary focus:ring-2 focus:ring-ring/20" /></div>
    <p id="code-help" className="text-sm leading-6 text-black/60 dark:text-white/60">Check your inbox and spam folder. Use the most recent code we sent you.</p>
    {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    {sendState?.error ? <p role="alert" className="text-sm text-destructive">{sendState.error}</p> : null}
    {sendState?.success ? <p role="status" className="text-sm text-primary">{sendState.success}</p> : null}
    <button type="submit" disabled={pending || sending} className={authButtonClass}>{pending ? "Verifying…" : "Verify email"}</button>
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground"><span>Didn&apos;t receive a code?</span><button type="submit" formAction={sendAction} formNoValidate disabled={pending || sending || coolingDown} className="font-medium text-primary underline underline-offset-4 disabled:cursor-default disabled:opacity-60">{sending ? "Sending…" : "Resend code"}</button>{coolingDown ? <span className="tabular-nums">({cooldown}s)</span> : null}</div>
  </form>;
}
