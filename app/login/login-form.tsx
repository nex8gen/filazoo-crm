"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "./actions";

export function LoginForm({ next = "/", message }: { next?: string; message?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1"><CardTitle className="text-lg font-semibold">Welcome back</CardTitle><CardDescription className="text-xs">Sign in to manage your B2B outreach workspace.</CardDescription></CardHeader>
      <CardContent>
        <form className="space-y-4" action={action}>
          <input type="hidden" name="next" value={next} />
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" defaultValue={state?.email} required autoFocus /></div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label htmlFor="password">Password</Label><Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">Forgot password?</Link></div>
            <div className="relative">
              <Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" className="pr-10" required />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
            </div>
          </div>
          {message && !state?.error ? <p role="status" className="text-xs text-primary">{message}</p> : null}
          {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
          <Button className="w-full" type="submit" disabled={pending}>{pending ? "Signing in..." : "Sign in"} <ArrowRight /></Button>
        </form>
      </CardContent>
    </Card>
  );
}
