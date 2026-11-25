import Link from "next/link";
import { requireWorkspaceMember } from "@/lib/auth";
import { listWorkspaceMembers } from "@/lib/data/members";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceNameForm } from "@/app/workspaces/workspace-forms";
import { LeaveWorkspaceForm, TransferOwnershipForm } from "../team-workspace-controls";

export const instant = false;
export default async function WorkspaceSettingsPage() {
  const viewer = await requireWorkspaceMember();
  if (viewer.workspaceId === "legacy") return <div className="settings-content space-y-4"><Card><CardHeader><CardTitle>Workspace management unavailable</CardTitle><CardDescription>Contact your administrator to enable workspace management. Your existing CRM and team access are available.</CardDescription></CardHeader><CardContent><Link href="/" className="text-sm text-primary underline underline-offset-4">Return to CRM</Link></CardContent></Card></div>;
  const members = viewer.ownerId === viewer.id ? await listWorkspaceMembers() : [];
  return <div className="settings-content space-y-5">
    <Card className="shadow-none"><CardHeader><CardTitle>Workspace details</CardTitle><CardDescription>Your CRM data and team permissions belong to this workspace.</CardDescription></CardHeader><CardContent>{viewer.role === "admin" ? <WorkspaceNameForm name={viewer.workspaceName} editing /> : <div className="space-y-2"><p className="text-xs text-muted-foreground">Workspace name</p><p data-no-translate className="break-words text-sm">{viewer.workspaceName}</p><p className="text-xs text-muted-foreground">Ask an administrator to change workspace details.</p></div>}<Link className="mt-5 block text-sm text-primary" href="/workspaces">Switch or create workspace</Link></CardContent></Card>
    {viewer.ownerId === viewer.id ? <Card className="shadow-none"><CardHeader><CardTitle>Workspace ownership</CardTitle><CardDescription>You are the owner. Transfer ownership before leaving.</CardDescription></CardHeader><CardContent><TransferOwnershipForm members={members.filter(m => m.id !== viewer.id && m.activated).map(m => ({ id: m.id, name: m.displayName || m.email }))} /></CardContent></Card> : <Card className="shadow-none"><CardHeader><CardTitle>Leave workspace</CardTitle></CardHeader><CardContent><LeaveWorkspaceForm /></CardContent></Card>}
  </div>;
}
