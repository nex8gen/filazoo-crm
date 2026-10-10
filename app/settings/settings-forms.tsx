"use client";

import { useActionState } from "react";
import { Send, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteMember, updateMemberRole, updateProfile } from "./actions";

function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (error) return <p role="alert" className="text-xs text-destructive">{error}</p>;
  if (success) return <p role="status" className="text-xs text-primary">{success}</p>;
  return null;
}

export function ProfileForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" defaultValue={displayName} autoComplete="name" required />
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      <Button type="submit" disabled={pending}><UserRound />{pending ? "Saving..." : "Save profile"}</Button>
    </form>
  );
}

export function InviteMemberForm() {
  const [state, action, pending] = useActionState(inviteMember, undefined);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="inviteName">Name</Label><Input id="inviteName" name="displayName" autoComplete="off" required /></div>
      <div className="space-y-2"><Label htmlFor="inviteEmail">Email</Label><Input id="inviteEmail" name="email" type="email" autoComplete="off" required /></div>
      <div className="space-y-2"><Label htmlFor="inviteRole">Role</Label><Select name="role" defaultValue="viewer"><SelectTrigger id="inviteRole"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="operator">Operator</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select></div>
      <div className="flex items-end"><Button type="submit" disabled={pending}><Send />{pending ? "Sending..." : "Send invitation"}</Button></div>
      <div className="md:col-span-2"><FormMessage error={state?.error} success={state?.success} /></div>
    </form>
  );
}

export function MemberRoleForm({ memberId, role }: { memberId: string; role: "admin" | "operator" | "viewer" }) {
  const [state, action, pending] = useActionState(updateMemberRole, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={memberId} />
      <Select name="role" defaultValue={role}>
        <SelectTrigger aria-label="Workspace role" size="sm"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="operator">Operator</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent>
      </Select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
      <FormMessage error={state?.error} success={state?.success} />
    </form>
  );
}
