import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading } from "@/components/auth-fields";
import { getViewer } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { invitationHash, validInvitationToken } from "@/lib/workspace-invitations";
import { JoinWorkspaceForm } from "./join-form";

export const metadata = { title: "Workspace invitation", robots: { index: false, follow: false } };
export const instant = false;
const invitationButtonClass = "flex h-12 w-full items-center justify-center rounded-[10px] bg-action px-5 text-base font-medium text-action-foreground hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-action-ring focus-visible:outline-offset-4";
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const viewer = await getViewer();
  const invitation = validInvitationToken(token) ? await createSupabaseControl().from("workspace_invitations")
    .select("email,role,expires_at,accepted_at,revoked_at,workspaces(name)").eq("token_hash", invitationHash(token)).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle() : null;
  const row = invitation?.data;
  const valid = Boolean(row);
  const workspace = row ? (Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces) : null;
  const next = encodeURIComponent(`/join/${token}`);
  return <AuthShell variant="signup">
    <div className="text-center"><AuthHeading title={valid ? `Join ${workspace?.name || "your team"}` : "Invitation unavailable"}>
      {row ? `You have been invited as ${row.role.replace("_", " ")}.` : "This link has expired, was revoked, or has already been accepted."}
    </AuthHeading></div>
    <div className="space-y-5">
      {valid ? viewer ? <>
        <p className="text-center text-sm leading-6 text-black/60 dark:text-white/60">Signed in as <span className="font-medium text-foreground" data-no-translate>{viewer.email}</span>. The invitation must match your verified email.</p>
        <JoinWorkspaceForm token={token} />
      </> : <>
        <p className="text-center text-sm leading-6 text-black/60 dark:text-white/60">Sign in or create an account using the email address that received this invitation.</p>
        <Link className={invitationButtonClass} href={`/login?next=${next}`}>Sign in to accept</Link>
        <Link className="flex h-12 w-full items-center justify-center rounded-[10px] border border-black/25 px-5 text-base font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4 dark:border-white/20 dark:hover:bg-white/5" href={`/signup?next=${next}`}>Create an account</Link>
      </> : <Link href="/workspaces" className={invitationButtonClass}>Open your workspaces</Link>}
    </div>
  </AuthShell>;
}
