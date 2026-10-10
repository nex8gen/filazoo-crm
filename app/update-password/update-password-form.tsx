"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { updatePassword } from "./actions";

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, undefined);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange(() => undefined);
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1"><CardTitle className="text-lg font-semibold">Choose a new password</CardTitle><CardDescription className="text-xs">Use at least 12 characters with uppercase, lowercase, a number, and a symbol.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="password">New password</Label><div className="relative"><Input id="password" name="password" type={visible ? "text" : "password"} autoComplete="new-password" className="pr-10" required autoFocus /><button type="button" onClick={() => setVisible((value) => !value)} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={visible ? "Hide passwords" : "Show passwords"}>{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
          <div className="space-y-2"><Label htmlFor="confirmation">Confirm new password</Label><Input id="confirmation" name="confirmation" type={visible ? "text" : "password"} autoComplete="new-password" required /></div>
          {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
          <Button className="w-full" type="submit" disabled={pending}><KeyRound />{pending ? "Updating..." : "Update password"}</Button>
        </form>
        <Button variant="ghost" className="w-full" render={<Link href="/login" />}>Cancel</Button>
      </CardContent>
    </Card>
  );
}
