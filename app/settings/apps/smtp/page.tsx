import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/auth";
import { listMailboxes } from "@/lib/data/mailboxes";
import { SettingsSkeleton } from "@/components/settings-skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonalMailboxForm, WorkspaceMailboxForm } from "../../settings-forms";

type Props = { searchParams: Promise<{ scope?: string; account?: string }> };

export default function SmtpSettingsPage(props: Props) {
  return <Suspense fallback={<SettingsSkeleton section="apps" />}><SmtpSettings {...props} /></Suspense>;
}

async function SmtpSettings({ searchParams }: Props) {
  const viewer = await requireWorkspaceMember();
  const query = await searchParams;
  const team = query.scope === "team";
  if (team && viewer.role !== "admin") notFound();
  const accounts = query.account ? await listMailboxes() : [];
  const account = accounts.find(item => item.id === query.account && (team ? item.type === "workspace" : item.type === "personal" && item.userId === viewer.id));
  if (query.account && !account) notFound();
  // Pass editable connection fields explicitly. Saved transport passwords stay on the server.
  const values = {
    mailboxId: account?.id ?? "", defaultEmail: account?.email ?? "", defaultDisplayName: account?.displayName ?? "",
    defaultSmtpHost: account?.smtpHost ?? "", defaultSmtpPort: account?.smtpPort ?? 587, defaultSmtpUsername: account?.smtpUsername ?? "",
    defaultImapHost: account?.imapHost ?? "", defaultImapPort: account?.imapPort ?? 993, defaultImapUsername: account?.imapUsername ?? "",
    defaultIsDefault: account?.isDefault ?? false, defaultProvider: account?.provider ?? "smtp", defaultNotes: account?.notes ?? "",
  };
  return <div className="settings-content settings-section-enter space-y-5">
    <Link href={`/settings/apps?view=${team ? "team" : "personal"}`} className="text-sm text-primary underline underline-offset-4">Back to email connections</Link>
    <Card><CardHeader><CardTitle>{account ? "Manage email connection" : team ? "Connect team email" : "Connect personal email"}</CardTitle><CardDescription>Use the SMTP and IMAP details from your email provider. Sending and receiving are tested before saving. Leave saved passwords blank to keep them.</CardDescription></CardHeader><CardContent>{team ? <WorkspaceMailboxForm key={account?.id ?? "new"} {...values} /> : <PersonalMailboxForm key={account?.id ?? "new"} {...values} />}</CardContent></Card>
  </div>;
}
