"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { leaveWorkspace, revokeTeamInvitation, transferWorkspaceOwnership } from "./team-actions";

export function RevokeInvitationForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(revokeTeamInvitation, undefined);
  return <form action={action}><input type="hidden" name="invitationId" value={id} /><Button variant="outline" size="sm" disabled={pending}>Revoke</Button>{state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}</form>;
}

export function TransferOwnershipForm({ members }: { members: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(transferWorkspaceOwnership, undefined);
  return <form action={action} className="space-y-3"><Label htmlFor="new-owner">New workspace owner</Label><select id="new-owner" name="userId" required className="h-9 w-full rounded-md border bg-background px-3 text-sm" defaultValue=""><option value="" disabled>Choose an active member</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><p className="text-xs text-muted-foreground">The new owner becomes an administrator. You remain an administrator.</p>{state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}{state?.success ? <NotificationToast tone="success">{state.success}</NotificationToast> : null}<Button variant="outline" disabled={pending || !members.length}>Transfer ownership</Button></form>;
}

export function LeaveWorkspaceForm() {
  const [state, action, pending] = useActionState(async () => {
    const result = await leaveWorkspace(undefined);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear all retained state when leaving a workspace.
    if (result?.success) window.location.assign("/workspaces");
    return result;
  }, undefined);
  return <form action={action} className="space-y-3"><p className="text-sm text-muted-foreground">Leaving removes your access to this workspace. Your account and other workspaces are kept.</p>{state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}<Button variant="outline" disabled={pending}>Leave workspace</Button></form>;
}
