"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "./actions";

export function LoginForm({ next = "/" }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1">
        <CardTitle className="text-lg font-semibold">Welcome back</CardTitle>
        <CardDescription className="text-xs">Sign in to manage your B2B outreach workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" action={action}>
          <input type="hidden" name="next" value={next} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required />
          </div>
          {state?.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
          <Button className="w-full" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"} <ArrowRight /></Button>
        </form>
      </CardContent>
    </Card>
  );
}
