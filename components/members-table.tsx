"use client";

import { useActionState, useEffect, useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { deleteMember, updateMember } from "@/app/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import type { WorkspaceMemberRecord } from "@/lib/data/members";

const PAGE_SIZE = 10;

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

function EditMemberDialog({ member, open, onOpenChange }: { member: WorkspaceMemberRecord; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, action, pending] = useActionState(updateMember, undefined);
  const [role, setRole] = useState(member.role);

  useEffect(() => {
    if (state?.success) onOpenChange(false);
  }, [state?.success, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit member</DialogTitle><DialogDescription>Update the member&apos;s identity, permissions, and assignment settings.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="userId" value={member.id} />
          <div className="space-y-2"><Label htmlFor={`member-name-${member.id}`}>Name</Label><Input id={`member-name-${member.id}`} name="displayName" defaultValue={member.displayName || ""} required /></div>
          <div className="space-y-2"><Label htmlFor={`member-email-${member.id}`}>Email</Label><Input id={`member-email-${member.id}`} name="email" type="email" defaultValue={member.email} required /></div>
          <div className="space-y-2"><Label htmlFor={`member-role-${member.id}`}>Role</Label><Select name="role" value={role} onValueChange={(value) => setRole(value as WorkspaceMemberRecord["role"])}><SelectTrigger id={`member-role-${member.id}`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="operator">Operator</SelectItem><SelectItem value="bd_manager">BD Sales Manager</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select></div>
          <label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><Checkbox name="autoAssignLeads" defaultChecked={member.autoAssignLeads} disabled={role !== "bd_manager"} /><span><span className="block font-medium">Automatic lead assignment</span><span className="mt-1 block text-xs text-muted-foreground">Include this BD Sales Manager in round-robin assignments.</span></span></label>
          {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
          <DialogFooter><DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save changes"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteMemberDialog({ member, open, onOpenChange }: { member: WorkspaceMemberRecord; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, action, pending] = useActionState(deleteMember, undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete member?</DialogTitle><DialogDescription>This removes {member.displayName || member.email} from the workspace, disconnects their personal mailbox, pauses their automations, and releases assigned leads. CRM history is preserved.</DialogDescription></DialogHeader>
        <form action={action}>
          <input type="hidden" name="userId" value={member.id} />
          {state?.error ? <p role="alert" className="mb-4 text-xs text-destructive">{state.error}</p> : null}
          <DialogFooter><DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose><Button type="submit" variant="destructive" disabled={pending}><Trash2 />{pending ? "Deleting..." : "Delete member"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberActions({ member }: { member: WorkspaceMemberRecord }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return <><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.displayName || member.email}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setEditOpen(true)}><Pencil />Edit member</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}><Trash2 />Delete member</DropdownMenuItem></DropdownMenuContent></DropdownMenu><EditMemberDialog member={member} open={editOpen} onOpenChange={setEditOpen} /><DeleteMemberDialog member={member} open={deleteOpen} onOpenChange={setDeleteOpen} /></>;
}

export function MembersTable({ members, viewerId }: { members: WorkspaceMemberRecord[]; viewerId: string }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleMembers = members.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <Card className="crm-table-frame crm-table-page-wide gap-0 overflow-hidden py-0 shadow-none">
      <Table>
        <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Activity</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>{visibleMembers.map((member) => <TableRow key={member.id}><TableCell><p className="text-sm font-medium">{member.displayName || "Unnamed member"}</p><p className="text-xs text-muted-foreground">{member.email}</p></TableCell><TableCell><Badge variant="outline" className="capitalize">{member.role.replace("_", " ")}</Badge>{member.autoAssignLeads && member.activated ? <p className="mt-1 text-xs text-muted-foreground">Auto-assign on</p> : null}</TableCell><TableCell><Badge variant={member.activated ? "secondary" : "outline"}>{member.activated ? "Active" : "Invited"}</Badge><p className="mt-1 text-xs text-muted-foreground">{member.activatedAt ? `Activated ${formatDate(member.activatedAt)}` : `Invited ${formatDate(member.createdAt)}`}</p></TableCell><TableCell className="text-xs"><p>Last sign-in: {formatDate(member.lastSignInAt)}</p><p className="mt-1 text-xs text-muted-foreground">Member since {formatDate(member.createdAt)}</p><p className="mt-1 text-xs text-muted-foreground">Updated {formatDate(member.updatedAt)}</p></TableCell><TableCell>{member.id === viewerId ? <Badge variant="outline">You</Badge> : <MemberActions member={member} />}</TableCell></TableRow>)}</TableBody>
      </Table>
      <TablePagination page={currentPage} pageCount={pageCount} start={visibleMembers.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0} end={Math.min(currentPage * PAGE_SIZE, members.length)} total={members.length} itemLabel="members" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
    </Card>
  );
}
