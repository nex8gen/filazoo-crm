import Link from "next/link";
import { requireWorkspaceMember } from "@/lib/auth";
import { listWorkspaceMembers } from "@/lib/data/members";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkspaceSettings } from "@/lib/data/workspace-settings";
import { WorkspaceDetailsForm, WorkspaceScheduleForm } from "./workspace-settings-form";
import { LeaveWorkspaceForm, TransferOwnershipForm } from "../team-workspace-controls";

export const instant = false;
export default async function WorkspaceSettingsPage() {
  const viewer = await requireWorkspaceMember();
  if (viewer.workspaceId === "legacy") return <div className="settings-content space-y-4"><Card><CardHeader><CardTitle>Workspace management unavailable</CardTitle><CardDescription>Contact your administrator to enable workspace management. Your existing CRM and team access are available.</CardDescription></CardHeader><CardContent><Link href="/" className="text-sm text-primary underline underline-offset-4">Return to CRM</Link></CardContent></Card></div>;
  const [members, settings] = await Promise.all([viewer.ownerId === viewer.id ? listWorkspaceMembers() : Promise.resolve([]), getWorkspaceSettings()]);
  const timezones = [...new Set([settings.timezone, "UTC", ...Intl.supportedValuesOf("timeZone")])].sort();
  return <div className="settings-content space-y-5">
    <Card className="shadow-none"><CardHeader><CardTitle>Workspace details</CardTitle></CardHeader><CardContent><WorkspaceDetailsForm name={viewer.workspaceName} settings={settings} editable={viewer.role === "admin"} /><Link className="mt-5 block text-sm text-primary" href="/workspaces">Switch or create workspace</Link></CardContent></Card>
    <Card className="shadow-none"><CardHeader><CardTitle>Time and business hours</CardTitle></CardHeader><CardContent><WorkspaceScheduleForm settings={settings} editable={viewer.role === "admin"} timezones={timezones} /></CardContent></Card>
    {viewer.role === "admin" ? <Card className="shadow-none"><CardHeader><CardTitle>Workspace activity log</CardTitle><CardDescription>Review changes to workspace settings, team access, ownership, and connections.</CardDescription></CardHeader><CardContent><Link href="/settings/workspace/activity" className="text-sm text-primary hover:underline">View activity log →</Link></CardContent></Card> : null}
    {viewer.ownerId === viewer.id ? <Card className="shadow-none"><CardHeader><CardTitle>Workspace ownership</CardTitle><CardDescription>You are the owner. Transfer ownership before leaving.</CardDescription></CardHeader><CardContent><TransferOwnershipForm members={members.filter(m => m.id !== viewer.id && m.activated).map(m => ({ id: m.id, name: m.displayName || m.email }))} /></CardContent></Card> : <Card className="shadow-none"><CardHeader><CardTitle>Leave workspace</CardTitle></CardHeader><CardContent><LeaveWorkspaceForm /></CardContent></Card>}
  </div>;
}
