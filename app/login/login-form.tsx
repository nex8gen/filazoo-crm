"use client";

import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1">
        <CardTitle className="text-lg font-semibold">Welcome back</CardTitle>
        <CardDescription className="text-xs">Sign in to manage your B2B outreach workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            toast("Demo mode", { description: "Authentication will be connected in a later step." });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground">Forgot password?</button>
            </div>
            <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required />
          </div>
          <Button className="w-full" type="submit">Sign in <ArrowRight /></Button>
        </form>
      </CardContent>
    </Card>
  );
}
