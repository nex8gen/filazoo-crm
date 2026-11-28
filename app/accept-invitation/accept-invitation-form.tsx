"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { AuthField, AuthHeading, authButtonClass } from "@/components/auth-fields";
import { acceptInvitation } from "./actions";

export function AcceptInvitationForm({ email, displayName, role }: { email: string; displayName: string; role: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, undefined);

  return (
    <>
      <div className="text-center"><AuthHeading title="Set up your account">Complete your NewAI profile and create your password.</AuthHeading></div>
        <form action={action} className="space-y-[var(--auth-form-gap,1.25rem)]" aria-busy={pending}>
          <AuthField label="Email" id="email" type="email" value={email} disabled />
          <AuthField label="Full name" id="displayName" name="displayName" defaultValue={displayName} autoComplete="name" minLength={2} maxLength={80} required autoFocus />
          <div className="rounded-[10px] border border-black/15 px-3 py-2 text-xs text-black/60 dark:border-white/20 dark:text-white/60">Workspace role: <span className="font-medium capitalize text-foreground">{role.replace("_", " ")}</span></div>
          <div className="space-y-1.5"><AuthField label="Password" id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} aria-describedby="invitation-password-help" required /><p id="invitation-password-help" className="text-xs leading-5 text-black/55 dark:text-white/55">12–72 characters: upper &amp; lowercase, number &amp; symbol.</p></div>
          <AuthField label="Confirm password" id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={72} required />
          {state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}
          <button className={authButtonClass} type="submit" disabled={pending}><CheckCircle2 className="size-4" aria-hidden="true" />{pending ? "Activating…" : "Activate account"}</button>
        </form>
        <Link href="/login" className="mt-5 block text-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80">Back to sign in</Link>
    </>
  );
}
