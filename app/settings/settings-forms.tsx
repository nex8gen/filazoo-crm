"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useActionState, useState } from "react";
import { useWorkspaceState } from "@/components/workspace-memory";
import { Mail, Send, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteMember, savePersonalMailbox, saveWorkspaceMailbox, updateMemberRole, updateProfile } from "./actions";
import { ConnectionEmailImport } from "@/components/email-import-fields";
import { newMailImportPreferences, type MailImportPreferences } from "@/lib/mail-import";
import { useUnsavedSettings } from "./use-unsaved-settings";

function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (error) return <NotificationToast>{error}</NotificationToast>;
  if (success) return <NotificationToast tone="success">{success}</NotificationToast>;
  return null;
}

export function ProfileForm({ displayName }: { displayName: string }) {
  const [draftName, setDraftName] = useWorkspaceState<string | null>("settings.profile.name", null);
  const dirty = draftName !== null && draftName !== displayName;
  useUnsavedSettings(dirty);
  const [state, action, pending] = useActionState(async (previous: Parameters<typeof updateProfile>[0], form: FormData) => {
    const result = await updateProfile(previous, form);
    if (result?.success) setDraftName(null);
    return result;
  }, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" value={draftName ?? displayName} onChange={event => setDraftName(event.target.value)} autoComplete="name" minLength={2} maxLength={80} disabled={pending} required />
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      <div className="flex gap-2"><Button type="submit" disabled={pending || !dirty}><UserRound />{pending ? "Saving..." : "Save profile"}</Button>{dirty ? <Button type="button" variant="outline" disabled={pending} onClick={() => setDraftName(null)}>Discard changes</Button> : null}</div>
    </form>
  );
}

export function InviteMemberForm() {
  const [state, action, pending] = useActionState(inviteMember, undefined);
  const [role, setRole] = useState("bd_manager");
  const roleHelp: Record<string, string> = { admin: "Manage team access and workspace settings.", operator: "Manage shared CRM records and billing.", bd_manager: "Manage assigned customers and receive automatic leads when enabled.", viewer: "View CRM records without changing shared data." };
  return (
    <form action={action} className="settings-fields-grid">
      <div className="space-y-2"><Label htmlFor="inviteName">Name</Label><Input id="inviteName" name="displayName" autoComplete="off" minLength={2} maxLength={80} disabled={pending} required /></div>
      <div className="space-y-2"><Label htmlFor="inviteEmail">Email</Label><Input id="inviteEmail" name="email" type="email" autoComplete="off" disabled={pending} required /></div>
      <div className="space-y-2"><Label htmlFor="inviteRole">Role</Label><Select name="role" value={role} onValueChange={value => { if (value !== null) setRole(value); }} disabled={pending}><SelectTrigger id="inviteRole" aria-describedby="invite-role-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="operator">Operator</SelectItem><SelectItem value="bd_manager">BD Sales Manager</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select><p id="invite-role-help" className="text-xs text-muted-foreground">{roleHelp[role]}</p></div>
      <div className="flex items-end"><Button type="submit" disabled={pending}><Send />{pending ? "Creating…" : "Invite member"}</Button></div>
      <div className="settings-field-full space-y-3"><FormMessage error={state?.error} success={state?.success} />{state?.invitationUrl ? <div className="space-y-2"><Label htmlFor="invitation-link">Secure invitation link</Label><Input id="invitation-link" readOnly value={state.invitationUrl} onFocus={event => event.target.select()} className="settings-control" /><Button type="button" variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(state.invitationUrl!); toast.success("Invitation link copied."); } catch { toast.error("Unable to copy. Select the invitation link and copy it manually."); } }}>Copy link</Button></div> : null}</div>
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
  defaultSyncPreferences?: MailImportPreferences;
  mailboxId?: string;
  defaultEmail?: string;
  defaultDisplayName?: string;
  defaultSmtpHost?: string;
  defaultSmtpPort?: number;
  defaultSmtpUsername?: string;
  defaultImapHost?: string;
  defaultImapPort?: number;
  defaultImapUsername?: string;
  defaultIsDefault?: boolean;
  defaultProvider?: string;
  defaultNotes?: string;
};

function MailboxFields({
  defaultSyncPreferences,
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
  defaultIsDefault,
  defaultProvider,
  defaultNotes,
  onEdit,
}: Required<MailboxFormProps> & { prefix: "workspace" | "personal"; onEdit: () => void }) {
  const titlePrefix = prefix === "workspace" ? "Workspace" : "Personal";
  return (
    <>
      <input type="hidden" name="mailboxId" value={mailboxId} />
      <div className="space-y-2">
        <Label htmlFor={`${prefix}MailboxEmail`}>{prefix === "workspace" ? "Common workspace email" : "Your email address"}</Label>
        <Input id={`${prefix}MailboxEmail`} name="email" type="email" readOnly={Boolean(mailboxId)} defaultValue={defaultEmail} placeholder={prefix === "workspace" ? "hello@company.com" : "bd.manager@company.com"} required className="settings-control" />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}MailboxLabel`}>Mailbox label</Label>
        <Input id={`${prefix}MailboxLabel`} name="displayName" defaultValue={defaultDisplayName} placeholder={`${titlePrefix} mailbox`} maxLength={80} />
      </div>
      <input type="hidden" name="provider" value={defaultProvider} />
      <div className="settings-fields-grid">
        <div className="space-y-2"><Label htmlFor={`${prefix}SmtpHost`}>SMTP host</Label><Input id={`${prefix}SmtpHost`} name="smtpHost" defaultValue={defaultSmtpHost} placeholder="smtp.gmail.com" required className="settings-control" /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}SmtpPort`}>SMTP port</Label><Input id={`${prefix}SmtpPort`} name="smtpPort" type="number" min={1} max={65535} step={1} defaultValue={defaultSmtpPort} required /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}SmtpUsername`}>SMTP username</Label><Input id={`${prefix}SmtpUsername`} name="smtpUsername" defaultValue={defaultSmtpUsername} placeholder={defaultEmail || "Email address"} required className="settings-control" /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}SmtpPassword`}>SMTP password / app password</Label><Input id={`${prefix}SmtpPassword`} name="smtpPassword" type="password" autoComplete="new-password" required={!mailboxId} maxLength={255} placeholder={mailboxId ? "Leave blank to keep the saved password" : "Required"} /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}ImapHost`}>IMAP host</Label><Input id={`${prefix}ImapHost`} name="imapHost" defaultValue={defaultImapHost} placeholder="imap.gmail.com" required className="settings-control" /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}ImapPort`}>IMAP port</Label><Input id={`${prefix}ImapPort`} name="imapPort" type="number" min={1} max={65535} step={1} defaultValue={defaultImapPort} required /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}ImapUsername`}>IMAP username</Label><Input id={`${prefix}ImapUsername`} name="imapUsername" defaultValue={defaultImapUsername} placeholder={defaultEmail || "Email address"} required className="settings-control" /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}ImapPassword`}>IMAP password / app password</Label><Input id={`${prefix}ImapPassword`} name="imapPassword" type="password" autoComplete="new-password" required={!mailboxId} maxLength={255} placeholder={mailboxId ? "Leave blank to keep the saved password" : "Required"} /></div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Use the server addresses, ports, and app passwords provided by your email service. Saving checks both sending and receiving.
      </p>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}MailboxNotes`}>Notes</Label>
        <Input id={`${prefix}MailboxNotes`} name="notes" defaultValue={defaultNotes} maxLength={240} />
      </div>
      <div className="settings-panel flex items-center justify-between gap-5 p-4">
        <Label htmlFor={`${prefix}-default-mailbox`} className="cursor-pointer text-sm">{prefix === "workspace" ? "Use this as the default workspace mailbox" : "Make this my default personal mailbox"}</Label>
        <Switch id={`${prefix}-default-mailbox`} name="isDefault" defaultChecked={defaultIsDefault} onCheckedChange={onEdit} />
      </div>
      <ConnectionEmailImport defaultValue={defaultSyncPreferences} />
    </>
  );
}

const mailboxDefaults = {
  defaultSyncPreferences: newMailImportPreferences,
  mailboxId: "",
  defaultEmail: "",
  defaultDisplayName: "",
  defaultSmtpHost: "",
  defaultSmtpPort: 587,
  defaultSmtpUsername: "",
  defaultImapHost: "",
  defaultImapPort: 993,
  defaultImapUsername: "",
  defaultIsDefault: false,
  defaultProvider: "smtp",
  defaultNotes: "",
};

export function WorkspaceMailboxForm(props: MailboxFormProps) {
  const [dirty, setDirty] = useState(false);
  useUnsavedSettings(dirty);
  const [state, action, pending] = useActionState(async (previous: Parameters<typeof saveWorkspaceMailbox>[0], form: FormData) => {
    const result = await saveWorkspaceMailbox(previous, form);
    if (result?.success) setDirty(false);
    return result;
  }, undefined);
  const values = { ...mailboxDefaults, defaultDisplayName: "Workspace mailbox", ...props };
  return (
    <form action={action} onChangeCapture={() => setDirty(true)} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4"><MailboxFields prefix="workspace" {...values} onEdit={() => setDirty(true)} /></fieldset>
      <FormMessage error={state?.error} success={state?.success} />
      <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs leading-5 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
        Your selected history imports automatically after connecting. Open <strong>Email</strong> to follow its progress or change <strong>Import settings</strong>.
      </div>
      <Button type="submit" disabled={pending}><ShieldCheck />{pending ? "Testing connection..." : props.mailboxId ? "Test and save connection" : "Test and connect mailbox"}</Button>
    </form>
  );
}

export function PersonalMailboxForm(props: MailboxFormProps) {
  const [dirty, setDirty] = useState(false);
  useUnsavedSettings(dirty);
  const [state, action, pending] = useActionState(async (previous: Parameters<typeof savePersonalMailbox>[0], form: FormData) => {
    const result = await savePersonalMailbox(previous, form);
    if (result?.success) setDirty(false);
    return result;
  }, undefined);
  const values = { ...mailboxDefaults, defaultDisplayName: "Personal mailbox", ...props };
  return (
    <form action={action} onChangeCapture={() => setDirty(true)} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4"><MailboxFields prefix="personal" {...values} onEdit={() => setDirty(true)} /></fieldset>
      <FormMessage error={state?.error} success={state?.success} />
      <Button type="submit" disabled={pending}><Mail />{pending ? "Testing connection..." : "Test and save my email"}</Button>
    </form>
  );
}
