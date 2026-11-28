import type { WorkspaceViewer } from "@/lib/auth";
import { listWorkspaceMembers } from "@/lib/data/members";
import { MembersTable } from "@/components/members-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteMemberForm } from "../settings-forms";
import { PendingInvitations } from "../pending-invitations";
import Link from "next/link";
import { readTeamCapacity } from "@/lib/data/team-capacity";

export async function TeamSection({ viewer }: { viewer: WorkspaceViewer }) {
  const [members, capacity] = await Promise.all([
    listWorkspaceMembers(),
    viewer.workspaceId === "legacy" ? null : readTeamCapacity(viewer).catch(() => null),
  ]);
  return <div className="settings-content settings-section-enter space-y-5">
    {viewer.workspaceId === "legacy" ? <p role="status" className="settings-panel p-4 text-sm text-muted-foreground">New invitations are unavailable in this workspace. Contact your administrator.</p> : <Card className="shadow-none">
      <CardHeader><CardTitle>Invite a team member</CardTitle><CardDescription>The workspace owner counts as one included user. Pending invitations reserve a user place.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {capacity ? <div className="settings-panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><span>Members: <strong>{capacity.memberCount}</strong><span className="mx-2" aria-hidden="true">·</span>Pending invitations: <strong>{capacity.pendingCount}</strong></span><span>Included users: <strong>{capacity.memberLimit ?? "No package limit"}</strong></span></div> : null}
        {!capacity ? <p role="status" className="text-sm text-muted-foreground">Unable to check available user places. Refresh to try again.</p>
          : capacity.canInvite ? <InviteMemberForm />
          : <div role="status" className="space-y-3 text-sm"><p>{!capacity.active ? "An active subscription is required to invite team members." : capacity.memberLimit === 1 ? "Starter includes one user: the workspace owner. Team invitations require a plan with more included users." : "Every included user place is in use or reserved. Revoke a pending invitation or remove a member before inviting someone else."}</p><Link href="/settings/credits" className="font-medium text-primary underline underline-offset-4">View plan and usage</Link></div>}
      </CardContent>
    </Card>}
    <PendingInvitations />
    <section aria-labelledby="workspace-members-title" className="settings-form-row"><div className="settings-row-heading"><h2 id="workspace-members-title">Workspace members</h2><p>Review member activity and manage access.</p></div><div className="settings-row-content"><MembersTable members={members} viewerId={viewer.id} /></div></section>
  </div>;
}
