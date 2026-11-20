"use client";

import { useActionState } from "react";
import { AuthField, authButtonClass } from "@/components/auth-fields";
import { confirmAccountEmail, sendAccountEmail, switchAccount } from "./actions";

export function AccountEmailForm({ next }: { next: string }) {
  const [sendState, send, sending] = useActionState(sendAccountEmail, undefined);
  const [verifyState, verify, verifying] = useActionState(confirmAccountEmail, undefined);
  return <div className="space-y-6"><form action={send} className="space-y-4"><input type="hidden" name="next" value={next} /><AuthField label="Email" id="account-email" name="email" type="email" autoComplete="email" required maxLength={254} /><button className={authButtonClass} disabled={sending || verifying}>{sending ? "Sending…" : "Send verification code"}</button>{sendState?.error && <p role="alert" className="text-sm text-red-600">{sendState.error}</p>}{sendState?.success && <p role="status" className="text-sm text-primary">{sendState.success}</p>}</form><form action={verify} className="space-y-4"><input type="hidden" name="next" value={next} /><AuthField label="Verification code" id="account-email-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required minLength={6} maxLength={10} /><button className={authButtonClass} disabled={sending || verifying}>{verifying ? "Verifying…" : "Verify email and continue"}</button>{verifyState?.error && <p role="alert" className="text-sm text-red-600">{verifyState.error}</p>}</form><form action={switchAccount}><button className="block text-center text-sm underline">Already have an account? Sign in with email first, then connect Alipay in your profile.</button></form></div>;
}
