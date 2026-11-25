"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { leaveWorkspace, revokeTeamInvitation, transferWorkspaceOwnership } from "./team-actions";

export function RevokeInvitationForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(revokeTeamInvitation, undefined);
  return <form action={action}><input type="hidden" name="invitationId" value={id} /><Button variant="outline" size="sm" disabled={pending}>Revoke</Button>{state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}</form>;
}

export function TransferOwnershipForm({ members }: { members: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(transferWorkspaceOwnership, undefined);
  const [selected, setSelected] = useState("");
  const [confirming, setConfirming] = useState(false);
  const target = members.find(member => member.id === selected);
  return <form action={action} onSubmit={event => { if (!confirming || !target || pending) event.preventDefault(); }} className="space-y-3"><Label htmlFor="new-owner">New workspace owner</Label><select id="new-owner" name="userId" required disabled={pending || !members.length} className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={selected} onChange={event => { setSelected(event.target.value); setConfirming(false); }}><option value="" disabled>Choose an active member</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><p className="text-xs text-muted-foreground">{members.length ? "The new owner becomes an administrator. You remain an administrator." : "Invite an active teammate before transferring ownership."}</p>{state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}{state?.success ? <NotificationToast tone="success">{state.success}</NotificationToast> : null}{confirming && target ? <div className="space-y-3 rounded-lg border p-4"><p className="text-sm">Transfer workspace ownership to <strong data-no-translate>{target.name}</strong>? Only the new owner can transfer it back.</p><div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Transferring…" : "Confirm transfer"}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button></div></div> : <Button type="button" variant="outline" disabled={pending || !target} onClick={() => setConfirming(true)}>Transfer ownership</Button>}</form>;
}

export function LeaveWorkspaceForm() {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(async () => {
    const result = await leaveWorkspace(undefined);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear all retained state when leaving a workspace.
    if (result?.success) window.location.assign("/workspaces");
    return result;
  }, undefined);
  return <form action={action} onSubmit={event => { if (!confirming || pending) event.preventDefault(); }} className="space-y-3"><p className="text-sm text-muted-foreground">Leaving removes your access to this workspace. Your account and other workspaces are kept.</p>{state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}{confirming ? <div className="space-y-3 rounded-lg border border-destructive/30 p-4"><p className="text-sm">Leave this workspace? You will need a new invitation to rejoin.</p><div className="flex gap-2"><Button type="submit" variant="destructive" disabled={pending}>{pending ? "Leaving…" : "Confirm leave"}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button></div></div> : <Button type="button" variant="outline" onClick={() => setConfirming(true)}>Leave workspace</Button>}</form>;
}
