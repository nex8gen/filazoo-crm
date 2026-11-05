import Link from "next/link";
import { requireWorkspaceMember } from "@/lib/auth";
import { listWorkspaceMembers } from "@/lib/data/members";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceNameForm } from "@/app/workspaces/workspace-forms";
import { LeaveWorkspaceForm, TransferOwnershipForm } from "../team-workspace-controls";

export const instant = false;
export default async function WorkspaceSettingsPage() {
  const viewer = await requireWorkspaceMember();
  if (viewer.workspaceId === "legacy") return <div className="settings-content space-y-4"><h1 className="text-2xl font-semibold">Workspace upgrade ready</h1><p className="text-sm text-muted-foreground">Your existing CRM and team remain available. Creating additional workspaces and managing ownership will be enabled after the database migration is approved and installed.</p><Link href="/" className="text-sm text-primary">Return to CRM</Link></div>;
  const members = viewer.ownerId === viewer.id ? await listWorkspaceMembers() : [];
  return <div className="settings-content space-y-5"><header className="border-b pb-6"><p className="mb-3 text-xs font-medium text-primary">Workspace</p><h1 className="text-2xl font-semibold">{viewer.workspaceName}</h1><p className="mt-2 text-sm text-muted-foreground">Manage your workspace and membership.</p></header>
    <Card className="shadow-none"><CardHeader><CardTitle>Workspace details</CardTitle><CardDescription>Your CRM data and team permissions belong to this workspace.</CardDescription></CardHeader><CardContent>{viewer.role === "admin" ? <WorkspaceNameForm name={viewer.workspaceName} editing /> : <p className="text-sm">Ask an administrator to change workspace details.</p>}<Link className="mt-5 block text-sm text-primary" href="/workspaces">Switch or create workspace</Link></CardContent></Card>
    {viewer.ownerId === viewer.id ? <Card className="shadow-none"><CardHeader><CardTitle>Workspace ownership</CardTitle><CardDescription>You are the owner. Transfer ownership before leaving.</CardDescription></CardHeader><CardContent><TransferOwnershipForm members={members.filter(m => m.id !== viewer.id && m.activated).map(m => ({ id: m.id, name: m.displayName || m.email }))} /></CardContent></Card> : <Card className="shadow-none"><CardHeader><CardTitle>Leave workspace</CardTitle></CardHeader><CardContent><LeaveWorkspaceForm /></CardContent></Card>}
  </div>;
}
