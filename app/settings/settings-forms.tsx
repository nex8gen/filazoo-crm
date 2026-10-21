"use client";

import { useActionState } from "react";
import { Mail, Send, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteMember, savePersonalMailbox, saveWorkspaceMailbox, updateMemberRole, updateProfile } from "./actions";

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
      <div className="space-y-2"><Label htmlFor="inviteRole">Role</Label><Select name="role" defaultValue="bd_manager"><SelectTrigger id="inviteRole"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="operator">Operator</SelectItem><SelectItem value="bd_manager">BD Sales Manager</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">BD Sales Managers join the automatic round-robin lead pool.</p></div>
      <div className="flex items-end"><Button type="submit" disabled={pending}><Send />{pending ? "Sending..." : "Send invitation"}</Button></div>
      <div className="md:col-span-2"><FormMessage error={state?.error} success={state?.success} /></div>
    </form>
  );
}

export function MemberRoleForm({ memberId, role }: { memberId: string; role: "admin" | "operator" | "bd_manager" | "viewer" }) {
  const [state, action, pending] = useActionState(updateMemberRole, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={memberId} />
      <Select name="role" defaultValue={role}>
        <SelectTrigger aria-label="Workspace role" size="sm"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="operator">Operator</SelectItem><SelectItem value="bd_manager">BD Sales Manager</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent>
      </Select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
      <FormMessage error={state?.error} success={state?.success} />
    </form>
  );
}

type MailboxFormProps = {
  mailboxId?: string;
  defaultEmail?: string;
  defaultDisplayName?: string;
  defaultSmtpHost?: string;
  defaultSmtpPort?: number;
  defaultSmtpUsername?: string;
  defaultImapHost?: string;
  defaultImapPort?: number;
  defaultImapUsername?: string;
};

function MailboxFields({
  prefix,
  mailboxId,
  defaultEmail,
  defaultDisplayName,
  defaultSmtpHost,
  defaultSmtpPort,
  defaultSmtpUsername,
  defaultImapHost,
  defaultImapPort,
  defaultImapUsername,
}: Required<MailboxFormProps> & { prefix: "workspace" | "personal" }) {
  const titlePrefix = prefix === "workspace" ? "Workspace" : "Personal";
  return (
    <>
      <input type="hidden" name="mailboxId" value={mailboxId} />
      <div className="space-y-2">
        <Label htmlFor={`${prefix}MailboxEmail`}>{prefix === "workspace" ? "Common workspace email" : "Your email address"}</Label>
        <Input id={`${prefix}MailboxEmail`} name="email" type="email" defaultValue={defaultEmail} placeholder={prefix === "workspace" ? "hello@company.com" : "bd.manager@company.com"} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}MailboxLabel`}>Mailbox label</Label>
        <Input id={`${prefix}MailboxLabel`} name="displayName" defaultValue={defaultDisplayName} placeholder={`${titlePrefix} mailbox`} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}MailboxProvider`}>Provider</Label>
        <Select name="provider" defaultValue="smtp">
          <SelectTrigger id={`${prefix}MailboxProvider`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="smtp">SMTP / IMAP</SelectItem>
            <SelectItem value="google">Google Workspace</SelectItem>
            <SelectItem value="microsoft">Microsoft 365</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor={`${prefix}SmtpHost`}>SMTP host</Label><Input id={`${prefix}SmtpHost`} name="smtpHost" defaultValue={defaultSmtpHost} placeholder="smtp.gmail.com" required /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}SmtpPort`}>SMTP port</Label><Input id={`${prefix}SmtpPort`} name="smtpPort" type="number" defaultValue={defaultSmtpPort} required /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}SmtpUsername`}>SMTP username</Label><Input id={`${prefix}SmtpUsername`} name="smtpUsername" defaultValue={defaultSmtpUsername} placeholder={defaultEmail || "Email address"} required /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}SmtpPassword`}>SMTP password / app password</Label><Input id={`${prefix}SmtpPassword`} name="smtpPassword" type="password" autoComplete="new-password" placeholder={mailboxId ? "Leave blank to keep the saved password" : "Required"} /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}ImapHost`}>IMAP host</Label><Input id={`${prefix}ImapHost`} name="imapHost" defaultValue={defaultImapHost} placeholder="imap.gmail.com" required /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}ImapPort`}>IMAP port</Label><Input id={`${prefix}ImapPort`} name="imapPort" type="number" defaultValue={defaultImapPort} required /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}ImapUsername`}>IMAP username</Label><Input id={`${prefix}ImapUsername`} name="imapUsername" defaultValue={defaultImapUsername} placeholder={defaultEmail || "Email address"} required /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}ImapPassword`}>IMAP password / app password</Label><Input id={`${prefix}ImapPassword`} name="imapPassword" type="password" autoComplete="new-password" placeholder={mailboxId ? "Leave blank to keep the saved password" : "Required"} /></div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Gmail: use your full Gmail address for both usernames and the same 16-character app password for both passwords. SMTP uses port 587 (STARTTLS); try port 465 if your network blocks 587. IMAP uses port 993.
      </p>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}MailboxNotes`}>Notes</Label>
        <Input id={`${prefix}MailboxNotes`} name="notes" defaultValue={prefix === "workspace" ? "Primary workspace mailbox" : "Personal manager mailbox"} />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="isDefault" defaultChecked />
        {prefix === "workspace" ? "Use this as the default workspace mailbox" : "Make this my default personal mailbox"}
      </label>
    </>
  );
}

const mailboxDefaults = {
  mailboxId: "",
  defaultEmail: "",
  defaultDisplayName: "",
  defaultSmtpHost: "",
  defaultSmtpPort: 587,
  defaultSmtpUsername: "",
  defaultImapHost: "",
  defaultImapPort: 993,
  defaultImapUsername: "",
};

export function WorkspaceMailboxForm(props: MailboxFormProps) {
  const [state, action, pending] = useActionState(saveWorkspaceMailbox, undefined);
  const values = { ...mailboxDefaults, defaultDisplayName: "Workspace mailbox", ...props };
  return (
    <form action={action} className="space-y-4">
      <MailboxFields prefix="workspace" {...values} />
      <FormMessage error={state?.error} success={state?.success} />
      <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs leading-5 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
        After saving, open <strong>Email</strong> and choose <strong>Import history</strong>. Shopify form enquiries appear automatically; IMAP collects past and new customer replies.
      </div>
      <Button type="submit" disabled={pending}><ShieldCheck />{pending ? "Testing connection..." : "Connect mailbox and enable inbox"}</Button>
    </form>
  );
}

export function PersonalMailboxForm(props: MailboxFormProps) {
  const [state, action, pending] = useActionState(savePersonalMailbox, undefined);
  const values = { ...mailboxDefaults, defaultDisplayName: "Personal mailbox", ...props };
  return (
    <form action={action} className="space-y-4">
      <MailboxFields prefix="personal" {...values} />
      <FormMessage error={state?.error} success={state?.success} />
      <Button type="submit" disabled={pending}><Mail />{pending ? "Testing connection..." : "Test and save my email"}</Button>
    </form>
  );
}
