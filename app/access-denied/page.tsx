import { Button } from "@/components/ui/button";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading } from "@/components/auth-fields";

export const metadata = { title: "Access denied" };

export default function AccessDeniedPage() {
  return (
    <AuthShell><AuthHeading title="You don't have access to this page">Your role in this workspace does not allow this action. Ask a workspace administrator for access, or choose another workspace.</AuthHeading>
      <div className="flex flex-wrap gap-3"><Button nativeButton={false} render={<Link href="/workspaces" />}>Choose a workspace</Button><Button nativeButton={false} variant="outline" render={<Link href="/workspaces/new" />}>Create a workspace</Button>
        <form action="/auth/signout" method="post"><Button type="submit" variant="outline">Sign out</Button></form>
      </div></AuthShell>
  );
}
