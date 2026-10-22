"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvitation } from "./actions";

export function AcceptInvitationForm({ email, displayName, role }: { email: string; displayName: string; role: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, undefined);
  const [visible, setVisible] = useState(false);

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1">
        <CardTitle className="text-lg font-semibold">Set up your account</CardTitle>
        <CardDescription className="text-xs">Complete your Filazoo CRM profile and create your password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" value={email} disabled /></div>
          <div className="space-y-2"><Label htmlFor="displayName">Full name</Label><Input id="displayName" name="displayName" defaultValue={displayName} autoComplete="name" minLength={2} maxLength={80} required autoFocus /></div>
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">Workspace role: <span className="font-medium capitalize text-foreground">{role.replace("_", " ")}</span></div>
          <div className="space-y-2"><Label htmlFor="password">Password</Label><div className="relative"><Input id="password" name="password" type={visible ? "text" : "password"} autoComplete="new-password" className="pr-10" required /><button type="button" onClick={() => setVisible((value) => !value)} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={visible ? "Hide passwords" : "Show passwords"}>{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div><p className="text-xs text-muted-foreground">At least 12 characters with uppercase, lowercase, a number, and a symbol.</p></div>
          <div className="space-y-2"><Label htmlFor="confirmation">Confirm password</Label><Input id="confirmation" name="confirmation" type={visible ? "text" : "password"} autoComplete="new-password" required /></div>
          {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
          <Button className="w-full" type="submit" disabled={pending}><CheckCircle2 />{pending ? "Activating..." : "Activate account"}</Button>
        </form>
        <Button nativeButton={false} variant="ghost" className="mt-2 w-full" render={<Link href="/login" />}>Back to sign in</Button>
      </CardContent>
    </Card>
  );
}
