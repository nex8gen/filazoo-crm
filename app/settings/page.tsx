import Link from "next/link";
import { KeyRound, ShieldCheck, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MembersTable } from "@/components/members-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireWorkspaceMember } from "@/lib/auth";
import { getDefaultWorkspaceMailbox, getUserMailbox, listMailboxes } from "@/lib/data/mailboxes";
import { listWorkspaceMembers } from "@/lib/data/members";
import { InviteMemberForm, PersonalMailboxForm, ProfileForm, WorkspaceMailboxForm } from "./settings-forms";

export default async function SettingsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const members = viewer.role === "admin" ? await listWorkspaceMembers() : [];

  const [defaultWorkspaceMailbox, personalMailbox, mailboxes] = await Promise.all([
    getDefaultWorkspaceMailbox().catch(() => null),
    getUserMailbox(viewer.id).catch(() => null),
    listMailboxes().catch(() => []),
  ]);

  return (
    <div>
      <PageHeader title="Settings" description="Manage your account security, profile, and workspace access." />
      <Tabs defaultValue="account" className="space-y-4">
        <TabsList><TabsTrigger value="account">Account</TabsTrigger><TabsTrigger value="security">Security</TabsTrigger>{viewer.role === "admin" ? <TabsTrigger value="team">Team</TabsTrigger> : null}</TabsList>

        <TabsContent value="account" className="space-y-4">
          <Card className="max-w-2xl shadow-none"><CardHeader><CardTitle className="text-sm">Profile</CardTitle><CardDescription className="text-xs">This name appears throughout the Filazoo workspace.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-1"><span className="text-xs text-muted-foreground">Email</span><span className="text-sm">{viewer.email}</span></div><Separator /><ProfileForm displayName={viewer.displayName || ""} /></CardContent></Card>
          <Card className="max-w-2xl shadow-none"><CardHeader><CardTitle className="text-sm">My mailbox</CardTitle><CardDescription className="text-xs">Add your BD / sales inbox. The CRM tests SMTP and IMAP before saving it.</CardDescription></CardHeader><CardContent><PersonalMailboxForm mailboxId={personalMailbox?.id || ""} defaultEmail={personalMailbox?.email || ""} defaultDisplayName={personalMailbox?.displayName || "Personal mailbox"} defaultSmtpHost={personalMailbox?.smtpHost || ""} defaultSmtpPort={personalMailbox?.smtpPort ?? 587} defaultSmtpUsername={personalMailbox?.smtpUsername || ""} defaultImapHost={personalMailbox?.imapHost || ""} defaultImapPort={personalMailbox?.imapPort ?? 993} defaultImapUsername={personalMailbox?.imapUsername || ""} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="security">
          <Card className="max-w-2xl shadow-none"><CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg border bg-muted"><ShieldCheck className="size-4 text-muted-foreground" /></div><CardTitle className="text-sm">Password and sessions</CardTitle><CardDescription className="text-xs">Use a unique password and rotate temporary credentials immediately.</CardDescription></CardHeader><CardContent className="flex flex-col items-start gap-4"><div><p className="text-xs text-muted-foreground">Workspace role</p><Badge variant="outline" className="mt-1 capitalize">{viewer.role}</Badge></div><Button nativeButton={false} render={<Link href="/update-password" />}><KeyRound />Change password</Button><p className="text-xs text-muted-foreground">Changing your password signs out the current session. Supabase refreshes active sessions using secure cookies.</p></CardContent></Card>
        </TabsContent>

        {viewer.role === "admin" ? (
          <TabsContent value="team" className="space-y-4">
            <Card className="shadow-none"><CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg border bg-muted"><UsersRound className="size-4 text-muted-foreground" /></div><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-sm">Shared customer inbox</CardTitle><CardDescription className="mt-1 text-xs">Connect once to collect Shopify form enquiries and customer email replies in one team inbox.</CardDescription></div>{defaultWorkspaceMailbox ? <Button nativeButton={false} variant="outline" size="sm" render={<Link href="/emails" />}>Open customer inbox</Button> : null}</div></CardHeader><CardContent><WorkspaceMailboxForm mailboxId={defaultWorkspaceMailbox?.id || ""} defaultEmail={defaultWorkspaceMailbox?.email || ""} defaultDisplayName={defaultWorkspaceMailbox?.displayName || "Workspace mailbox"} defaultSmtpHost={defaultWorkspaceMailbox?.smtpHost || ""} defaultSmtpPort={defaultWorkspaceMailbox?.smtpPort ?? 587} defaultSmtpUsername={defaultWorkspaceMailbox?.smtpUsername || ""} defaultImapHost={defaultWorkspaceMailbox?.imapHost || ""} defaultImapPort={defaultWorkspaceMailbox?.imapPort ?? 993} defaultImapUsername={defaultWorkspaceMailbox?.imapUsername || ""} /></CardContent></Card>
            <Card className="shadow-none"><CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg border bg-muted"><UsersRound className="size-4 text-muted-foreground" /></div><CardTitle className="text-sm">Invite a team member</CardTitle><CardDescription className="text-xs">Choose BD Sales Manager to include the person in automatic round-robin lead assignment. New users receive a secure email invitation.</CardDescription></CardHeader><CardContent><InviteMemberForm /></CardContent></Card>
            <div className="space-y-2"><div><h3 className="text-sm font-semibold">Workspace members</h3><p className="text-xs text-muted-foreground">Track account status and activity, edit access, or safely remove a member.</p></div><MembersTable members={members} viewerId={viewer.id} /></div>
            <Card className="shadow-none"><CardHeader><CardTitle className="text-sm">Configured mailboxes</CardTitle><CardDescription className="text-xs">Current workspace and user inboxes stored in the CRM.</CardDescription></CardHeader><CardContent><div className="space-y-2">{mailboxes.length ? mailboxes.map((mailbox) => <div key={mailbox.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"><div><p className="font-medium text-foreground">{mailbox.email}</p><p className="text-muted-foreground">{mailbox.type === "workspace" ? "Common mailbox" : "Personal mailbox"}{mailbox.isDefault ? " · default" : ""}</p></div><Badge variant={mailbox.type === "workspace" ? "secondary" : "outline"}>{mailbox.type}</Badge></div>) : <p className="text-xs text-muted-foreground">No mailboxes configured yet.</p>}</div></CardContent></Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
