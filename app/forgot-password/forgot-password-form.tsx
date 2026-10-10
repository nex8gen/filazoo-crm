"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1"><CardTitle className="text-lg font-semibold">Reset your password</CardTitle><CardDescription className="text-xs">We will send a secure recovery link to your workspace email.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" defaultValue={state?.email} placeholder="you@company.com" required autoFocus /></div>
          {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-xs text-primary">{state.success}</p> : null}
          <Button className="w-full" type="submit" disabled={pending}><Mail />{pending ? "Sending..." : "Send recovery link"}</Button>
        </form>
        <Button variant="ghost" className="w-full" render={<Link href="/login" />}><ArrowLeft />Back to sign in</Button>
      </CardContent>
    </Card>
  );
}
