import type { WorkspaceViewer } from "@/lib/auth";
import { listWorkspaceMembers } from "@/lib/data/members";
import { MembersTable } from "@/components/members-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteMemberForm } from "../settings-forms";
import { PendingInvitations } from "../pending-invitations";

export async function TeamSection({ viewer }: { viewer: WorkspaceViewer }) {
  const members = await listWorkspaceMembers();
  return <div className="settings-content settings-section-enter space-y-5">
    <Card className="shadow-none"><CardHeader><CardTitle>Invite a team member</CardTitle><CardDescription>Choose the access each person needs. Invitations appear below until accepted.</CardDescription></CardHeader><CardContent><InviteMemberForm /></CardContent></Card>
    <PendingInvitations />
    <section aria-labelledby="workspace-members-title" className="space-y-3"><div><h2 id="workspace-members-title" className="text-sm font-semibold">Workspace members</h2><p className="text-sm text-muted-foreground">Track account status and activity, edit access, or safely remove a member.</p></div><MembersTable members={members} viewerId={viewer.id} /></section>
  </div>;
}
