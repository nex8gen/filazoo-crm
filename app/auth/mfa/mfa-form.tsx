"use client";

import { useState, useTransition } from "react";
import { AuthField, authButtonClass } from "@/components/auth-fields";
import { NotificationToast } from "@/components/ui/notification-toast";
import { createClient } from "@/lib/supabase/client";
import { securityError } from "@/lib/account-security";
import { safeInternalPath } from "@/lib/safe-redirect";

export function MfaForm({ next, factors, error: initialError }: { next: string; factors: { id: string; friendly_name?: string }[]; error?: string }) {
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [pending, startTransition] = useTransition();
  return <><h1 className="mb-3 text-center text-3xl font-medium tracking-tight">Two-step verification</h1><p className="mb-8 text-center text-sm text-muted-foreground">Enter the six-digit code from your authenticator app to finish signing in.</p><form className="space-y-6" onSubmit={event => {
    event.preventDefault(); setError("");
    startTransition(async () => {
      try {
        const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code });
        if (error) { setError(securityError(error, "Unable to verify your code. Please try again.")); return; }
        const destination = safeInternalPath(next);
        window.location.assign(/^\/(auth|login)(\/|\?|$)/.test(destination) ? "/" : destination);
      } catch { setError("Unable to verify your code. Check your connection and try again."); }
    });
  }}>
    {factors.length > 1 ? <div className="space-y-2"><label htmlFor="mfa-factor" className="text-sm font-medium">Authenticator</label><select id="mfa-factor" value={factorId} onChange={event => setFactorId(event.target.value)} disabled={pending} className="w-full rounded-lg border bg-background p-3 text-sm">{factors.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.friendly_name || `Authenticator ${index + 1}`}</option>)}</select></div> : null}
    <AuthField id="mfa-code" label="Authenticator code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required autoFocus disabled={pending} />
    {error ? <NotificationToast>{error}</NotificationToast> : null}
    <button type="submit" className={authButtonClass} disabled={pending || !factorId || code.length !== 6}>{pending ? "Verifying…" : "Verify and sign in"}</button>
  </form><p className="mt-6 text-center text-xs leading-5 text-muted-foreground">If you changed phones, choose a backup authenticator. If you have lost every authenticator, contact your account administrator for identity verification and a reset.</p><form action="/auth/signout" method="post" className="mt-5 text-center"><button type="submit" disabled={pending} className="text-sm underline underline-offset-4">Use a different account</button></form></>;
}
