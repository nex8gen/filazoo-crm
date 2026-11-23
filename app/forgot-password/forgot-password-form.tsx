"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthField, AuthHeading, authButtonClass } from "@/components/auth-fields";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm({ next = "/", email }: { next?: string; email?: string }) {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  const loginQuery = new URLSearchParams({ next, email: state?.email ?? email ?? "" });
  return (
    <><AuthHeading title="Forgot your password?">Enter your account email and we will send you a secure recovery link.</AuthHeading><div className="space-y-4">
        <form action={action} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <AuthField label="Email" id="email" name="email" type="email" autoComplete="email" defaultValue={state?.email ?? email} placeholder="you@company.com" required />
          {state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}
          {state?.success ? <NotificationToast tone="success">{state.success}</NotificationToast> : null}
          <button className={authButtonClass} type="submit" disabled={pending}><Mail className="size-4" />{pending ? "Sending…" : "Send recovery link"}</button>
        </form>
        <Button nativeButton={false} variant="ghost" className="w-full" render={<Link href={`/login?${loginQuery}`} />}><ArrowLeft />Back to sign in</Button>
      </div></>
  );
}
