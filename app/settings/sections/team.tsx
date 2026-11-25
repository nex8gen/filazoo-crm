import type { WorkspaceViewer } from "@/lib/auth";
import { listWorkspaceMembers } from "@/lib/data/members";
import { MembersTable } from "@/components/members-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteMemberForm } from "../settings-forms";
import { PendingInvitations } from "../pending-invitations";

export async function TeamSection({ viewer }: { viewer: WorkspaceViewer }) {
  const members = await listWorkspaceMembers();
  return <div className="settings-content settings-section-enter space-y-5">
    {viewer.workspaceId === "legacy" ? <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">New invitations are unavailable in this workspace. Contact your administrator.</p> : <Card className="shadow-none"><CardHeader><CardTitle>Invite a team member</CardTitle><CardDescription>Choose the access each person needs. Invitations appear below until accepted.</CardDescription></CardHeader><CardContent><InviteMemberForm /></CardContent></Card>}
    <PendingInvitations />
    <section aria-labelledby="workspace-members-title" className="space-y-3"><div><h2 id="workspace-members-title" className="text-sm font-semibold">Workspace members</h2><p className="text-sm text-muted-foreground">Review member activity and manage access.</p></div><MembersTable members={members} viewerId={viewer.id} /></section>
  </div>;
}
