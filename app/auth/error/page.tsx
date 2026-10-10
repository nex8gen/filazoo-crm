import Link from "next/link";
import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Authentication error" };

export default function AuthErrorPage() {
  return (
    <AuthShell>
      <Card className="shadow-none"><CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg border bg-muted"><CircleAlert className="size-4 text-muted-foreground" /></div><CardTitle className="text-lg">This authentication link is invalid</CardTitle><CardDescription className="text-xs">The link may have expired or already been used. Request a new password recovery link and try again.</CardDescription></CardHeader><CardContent className="flex gap-2"><Button className="flex-1" render={<Link href="/forgot-password" />}>Request new link</Button><Button className="flex-1" variant="outline" render={<Link href="/login" />}>Back to login</Button></CardContent></Card>
    </AuthShell>
  );
}
