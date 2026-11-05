import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getViewer } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { invitationHash, validInvitationToken } from "@/lib/workspace-invitations";
import { JoinWorkspaceForm } from "./join-form";

export const metadata = { title: "Workspace invitation", robots: { index: false, follow: false } };
export const instant = false;
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const viewer = await getViewer();
  const invitation = validInvitationToken(token) ? await createSupabaseControl().from("workspace_invitations")
    .select("email,role,expires_at,accepted_at,revoked_at,workspaces(name)").eq("token_hash", invitationHash(token)).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle() : null;
  const row = invitation?.data;
  const valid = Boolean(row);
  const workspace = row ? (Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces) : null;
  const next = encodeURIComponent(`/join/${token}`);
  return <AuthShell animatedBackground><Card className="shadow-none"><CardHeader><CardTitle>{valid ? `Join ${workspace?.name || "your team"}` : "Invitation unavailable"}</CardTitle><CardDescription>{row ? `You have been invited as ${row.role.replace("_", " ")}.` : "This link has expired, was revoked, or has already been accepted."}</CardDescription></CardHeader><CardContent className="space-y-4">
    {valid ? viewer ? <><p className="text-sm text-muted-foreground">Signed in as {viewer.email}. The invitation must match your verified email.</p><JoinWorkspaceForm token={token} /></> : <><p className="text-sm text-muted-foreground">Sign in or create an account using the email address that received this invitation.</p><Link className="block rounded-md bg-primary p-3 text-center text-sm text-primary-foreground" href={`/login?next=${next}`}>Sign in to accept</Link><Link className="block text-center text-sm text-primary" href={`/signup?next=${next}`}>Create an account</Link></> : <Link href="/workspaces" className="text-sm text-primary">Open your workspaces</Link>}
  </CardContent></Card></AuthShell>;
}
