"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthField, AuthHeading, authButtonClass } from "@/components/auth-fields";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <><AuthHeading title="Forgot your password?">Enter your account email and we will send you a secure recovery link.</AuthHeading><div className="space-y-4">
        <form action={action} className="space-y-4">
          <AuthField label="Email" id="email" name="email" type="email" autoComplete="email" defaultValue={state?.email} placeholder="you@company.com" required />
          {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-xs text-primary">{state.success}</p> : null}
          <button className={authButtonClass} type="submit" disabled={pending}><Mail className="size-4" />{pending ? "Sending…" : "Send recovery link"}</button>
        </form>
        <Button nativeButton={false} variant="ghost" className="w-full" render={<Link href="/login" />}><ArrowLeft />Back to sign in</Button>
      </div></>
  );
}
