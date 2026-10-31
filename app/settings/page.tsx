import { EmptyState } from "@/components/data-state";
import { Mail } from "lucide-react";
import Link from "next/link";
import { CheckCircle2, KeyRound, Settings2, ShieldCheck, Shuffle, UserRoundCheck, UsersRound } from "lucide-react";
import { MembersTable } from "@/components/members-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { notFound, redirect } from "next/navigation";
import { AppearanceSettings } from "./appearance-settings";
import { ProfilePhotoForm } from "./profile-photo-form";
import { profileAvatarUrl } from "@/lib/profile-avatar";
import { requireWorkspaceMember } from "@/lib/auth";
import { getDefaultWorkspaceMailbox, getUserMailbox, listMailboxes } from "@/lib/data/mailboxes";
import { listWorkspaceMembers } from "@/lib/data/members";
import { InviteMemberForm, PersonalMailboxForm, ProfileForm, WorkspaceMailboxForm } from "./settings-forms";
import { MailboxManager } from "./mailbox-manager";
import { PaymentMethodsForm } from "./payment-methods-form";
import { invoicePaymentMethods } from "@/lib/data/invoice-payment-methods";
import { canManageBilling } from "@/lib/invoice-permissions";
import { PreferencesForm, SessionSettings } from "./preferences-form";
import { SettingsLanguage } from "./settings-language";
import { settingsSections } from "@/lib/settings-sections";
import { Suspense } from "react";
import { SettingsSkeleton } from "@/components/settings-skeleton";
import { InvoiceDefaultsForm } from "./invoice-defaults-form";
import { getInvoiceDefaults } from "@/lib/data/invoice-defaults";
import { getErpSettingsView } from "@/lib/data/erp-settings";
import { getInventoryState } from "@/lib/data/inventory";
import { listProducts } from "@/lib/data/crm";
import { ErpConnectionForm } from "./erp-connection-form";
import { AiSettingsForm } from "./ai-settings-form";
import { getAiSettings } from "@/lib/data/ai-settings";

type SettingsPageProps = { params?: Promise<{ section?: string }> };

export default function SettingsPage(props: SettingsPageProps) {
  return <Suspense fallback={<SettingsSkeleton />}><SettingsWorkspace {...props} /></Suspense>;
}

async function SettingsWorkspace({ params }: SettingsPageProps) {
  const section = (await params)?.section || "general";
  if (section === "integrations") redirect("/settings/apps");
  const titles: Record<string, string> = Object.fromEntries(settingsSections.map(item => [item.id, item.title]));
  const currentSection = settingsSections.find(item => item.id === section);
  if (!titles[section]) notFound();
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const aiSettings = section === "ai" ? await getAiSettings() : null;
  if ((section === "team" || section === "advanced" || section === "erp") && viewer.role !== "admin") notFound();
  const [members, paymentMethods, invoiceDefaults, erp, defaultWorkspaceMailbox, personalMailbox, mailboxResult] = await Promise.all([
    viewer.role === "admin" && (section === "team" || section === "advanced") ? listWorkspaceMembers() : Promise.resolve([]),
    section === "payments" ? invoicePaymentMethods() : Promise.resolve([]),
    section === "invoices" ? getInvoiceDefaults() : Promise.resolve(null),
    section === "erp" ? Promise.all([getErpSettingsView(), getInventoryState(), listProducts()]) : Promise.resolve(null),
    section === "team" ? getDefaultWorkspaceMailbox().catch(() => null) : Promise.resolve(null),
    section === "mailboxes" ? getUserMailbox(viewer.id).catch(() => null) : Promise.resolve(null),
    section === "mailboxes" || section === "team" ? listMailboxes().then((mailboxes) => ({ mailboxes, error: "" })).catch(() => ({ mailboxes: [], error: "Unable to load configured mailboxes. Please refresh Settings." })) : Promise.resolve({ mailboxes: [], error: "" }),
  ]);
  const { mailboxes, error: mailboxError } = mailboxResult;
  const ownMailboxes = mailboxes.filter((mailbox) => mailbox.type === "personal" && mailbox.userId === viewer.id);
  const assignmentManagers = members.filter((member) => member.role === "bd_manager" && member.autoAssignLeads && member.activated);
  if (aiSettings) return <div className="settings-content settings-section-enter !max-w-3xl space-y-5"><header className="mb-6 border-b pb-6"><p className="mb-3 text-xs font-medium text-primary">Workspace</p><h1 className="text-2xl font-semibold tracking-tight">AI access & behavior</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Control what AI can read, what it can do, and how it writes for your team.</p></header><AiSettingsForm initial={aiSettings} canManage={viewer.role === "admin"} /></div>;

  return (
    <div key={section} className={`settings-content settings-section-enter space-y-5 ${section === "team" || section === "advanced" || section === "erp" ? "!max-w-5xl" : "!max-w-3xl"}`}>
      <header className="mb-6 border-b pb-6"><p className="mb-3 text-xs font-medium text-primary">{currentSection?.group || "Email & connections"}</p><h1 className="text-2xl font-semibold tracking-tight">{titles[section]}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{currentSection?.description || "Manage connected channels and open their workspaces."}</p></header>
      {erp ? <ErpConnectionForm key={erp[0].revision} initial={erp[0]} status={erp[1].status} products={[...new Map(erp[2].products.flatMap(product => [{ sku: product.sku, name: product.name }, ...product.variants.map(variant => ({ sku: variant.sku, name: `${product.name} — ${variant.name}` }))]).map(product => [product.sku, product])).values()]} /> : null}
      {section === "general" ? <div className="grid gap-5"><Card className="shadow-none"><CardHeader><CardTitle>Language</CardTitle><CardDescription>Choose English or Chinese for this browser.</CardDescription></CardHeader><CardContent><SettingsLanguage /></CardContent></Card><Card className="shadow-none"><CardHeader><CardTitle>List preferences</CardTitle><CardDescription>Choose how many records you see when browsing your CRM.</CardDescription></CardHeader><CardContent><PreferencesForm section="general" /></CardContent></Card></div> : null}
      {section === "appearance" ? <Card className="shadow-none"><CardHeader><CardTitle>Color theme</CardTitle><CardDescription>Choose a theme or follow your device settings.</CardDescription></CardHeader><CardContent><AppearanceSettings /></CardContent></Card> : null}
      {section === "appearance" ? <Card className="mb-4 max-w-2xl shadow-none"><CardHeader><CardTitle>Display and accessibility</CardTitle><CardDescription>Control table spacing and animation across your workspace.</CardDescription></CardHeader><CardContent><PreferencesForm section="appearance" /></CardContent></Card> : null}
      {section === "email" ? <Card className="max-w-2xl shadow-none"><CardHeader><CardTitle>Reading and sending</CardTitle><CardDescription>Your defaults for the email inbox and company conversations.</CardDescription></CardHeader><CardContent><PreferencesForm section="email" /><Separator className="my-5" /><Button variant="outline" nativeButton={false} render={<Link href="/settings/mailboxes" />}>Manage my mailbox</Button></CardContent></Card> : null}
      {section === "invoices" && invoiceDefaults ? <Card className="max-w-2xl shadow-none"><CardHeader><CardTitle>Seller and invoice defaults</CardTitle><CardDescription>Shared workspace defaults for new invoices. Customer billing profiles can override currency and due dates. Existing invoices keep their saved details.</CardDescription></CardHeader><CardContent><InvoiceDefaultsForm initial={invoiceDefaults} canManage={canManageBilling(viewer.role)} /></CardContent></Card> : null}
      {section === "security" ? <Card className="mb-4 max-w-2xl shadow-none"><CardHeader><CardTitle>Other devices</CardTitle><CardDescription>End your other signed-in sessions.</CardDescription></CardHeader><CardContent><SessionSettings /></CardContent></Card> : null}
      {section === "payments" ? <Card className="max-w-2xl shadow-none"><CardHeader><CardTitle>Customer payment methods</CardTitle><CardDescription>Add bank transfer, PayPal, and other payment instructions to offer on customer invoices.</CardDescription></CardHeader><CardContent><PaymentMethodsForm initial={paymentMethods} canManage={canManageBilling(viewer.role)} /></CardContent></Card> : null}
      {section === "general" ? <Card className="max-w-2xl shadow-none"><CardHeader><CardTitle>Account overview</CardTitle><CardDescription>Your Filazoo workspace account and preferences.</CardDescription></CardHeader><CardContent className="space-y-5"><div><p className="text-sm font-medium">{viewer.displayName || "Account"}</p><p className="mt-1 text-sm text-muted-foreground">{viewer.email}</p><Badge variant="outline" className="mt-3 capitalize">{viewer.role}</Badge></div><Separator /><div className="flex flex-wrap gap-3"><Button nativeButton={false} render={<Link href="/settings/profile" />}>Edit profile</Button><Button variant="outline" nativeButton={false} render={<Link href="/settings/appearance" />}>Appearance</Button></div></CardContent></Card> : null}

        {section === "profile" ? <div className="space-y-4">
          <Card className="max-w-2xl shadow-none"><CardHeader><CardTitle className="text-sm">Profile</CardTitle><CardDescription className="text-xs">This name appears throughout the Filazoo workspace.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-1"><span className="text-xs text-muted-foreground">Email</span><span className="text-sm">{viewer.email}</span></div><Separator /><ProfilePhotoForm userId={viewer.id} name={viewer.displayName || "Account"} imageUrl={profileAvatarUrl(viewer.id, viewer.avatarPath)} preset={viewer.avatarPreset || "male"} /><Separator /><ProfileForm displayName={viewer.displayName || ""} /></CardContent></Card>
        </div> : null}
        {section === "mailboxes" ? <div className="space-y-4">
          <Card className="max-w-2xl shadow-none"><CardHeader><CardTitle className="text-sm">My mailbox</CardTitle><CardDescription className="text-xs">Add your BD / sales inbox. The CRM tests SMTP and IMAP before saving it.</CardDescription></CardHeader><CardContent><PersonalMailboxForm mailboxId={personalMailbox?.id || ""} defaultEmail={personalMailbox?.email || ""} defaultDisplayName={personalMailbox?.displayName || "Personal mailbox"} defaultSmtpHost={personalMailbox?.smtpHost || ""} defaultSmtpPort={personalMailbox?.smtpPort ?? 587} defaultSmtpUsername={personalMailbox?.smtpUsername || ""} defaultImapHost={personalMailbox?.imapHost || ""} defaultImapPort={personalMailbox?.imapPort ?? 993} defaultImapUsername={personalMailbox?.imapUsername || ""} /></CardContent></Card>
          {ownMailboxes.length || mailboxError ? <Card className="max-w-2xl shadow-none"><CardHeader><CardTitle className="text-sm">My configured mailboxes</CardTitle><CardDescription className="text-xs">Stop sending and syncing, resume a mailbox, or delete its connection.</CardDescription></CardHeader><CardContent className="space-y-2">{mailboxError ? <p role="alert" className="text-xs text-destructive">{mailboxError}</p> : ownMailboxes.map((mailbox) => <MailboxManager key={mailbox.id} mailbox={{ id: mailbox.id, email: mailbox.email, type: mailbox.type, isDefault: mailbox.isDefault, isActive: mailbox.isActive }} />)}</CardContent></Card> : null}
        </div> : null}

        {section === "security" ? <div>
          <Card className="max-w-2xl shadow-none"><CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg border bg-muted"><ShieldCheck className="size-4 text-muted-foreground" /></div><CardTitle className="text-sm">Password and sessions</CardTitle><CardDescription className="text-xs">Use a unique password and rotate temporary credentials immediately.</CardDescription></CardHeader><CardContent className="flex flex-col items-start gap-4"><div><p className="text-xs text-muted-foreground">Workspace role</p><Badge variant="outline" className="mt-1 capitalize">{viewer.role}</Badge></div><Button nativeButton={false} render={<Link href="/update-password" />}><KeyRound />Change password</Button><p className="text-xs text-muted-foreground">Changing your password signs out the current session. Supabase refreshes active sessions using secure cookies.</p></CardContent></Card>
        </div> : null}

        {viewer.role === "admin" && section === "team" ? (
          <div className="space-y-4">
            <Card className="shadow-none"><CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg border bg-muted"><UsersRound className="size-4 text-muted-foreground" /></div><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-sm">Shared customer inbox</CardTitle><CardDescription className="mt-1 text-xs">Connect once to collect Shopify form enquiries and customer email replies in one team inbox.</CardDescription></div>{defaultWorkspaceMailbox ? <Button nativeButton={false} variant="outline" size="sm" render={<Link href="/emails" />}>Open customer inbox</Button> : null}</div></CardHeader><CardContent><WorkspaceMailboxForm mailboxId={defaultWorkspaceMailbox?.id || ""} defaultEmail={defaultWorkspaceMailbox?.email || ""} defaultDisplayName={defaultWorkspaceMailbox?.displayName || "Workspace mailbox"} defaultSmtpHost={defaultWorkspaceMailbox?.smtpHost || ""} defaultSmtpPort={defaultWorkspaceMailbox?.smtpPort ?? 587} defaultSmtpUsername={defaultWorkspaceMailbox?.smtpUsername || ""} defaultImapHost={defaultWorkspaceMailbox?.imapHost || ""} defaultImapPort={defaultWorkspaceMailbox?.imapPort ?? 993} defaultImapUsername={defaultWorkspaceMailbox?.imapUsername || ""} /></CardContent></Card>
            <Card className="shadow-none"><CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg border bg-muted"><UsersRound className="size-4 text-muted-foreground" /></div><CardTitle className="text-sm">Invite a team member</CardTitle><CardDescription className="text-xs">Choose BD Sales Manager to include the person in automatic round-robin lead assignment. New users receive a secure email invitation.</CardDescription></CardHeader><CardContent><InviteMemberForm /></CardContent></Card>
            <div className="space-y-2"><div><h3 className="text-sm font-semibold">Workspace members</h3><p className="text-xs text-muted-foreground">Track account status and activity, edit access, or safely remove a member.</p></div><MembersTable members={members} viewerId={viewer.id} /></div>
            <Card className="shadow-none"><CardHeader><CardTitle className="text-sm">Configured mailboxes</CardTitle><CardDescription className="text-xs">Stop sending and syncing, resume a mailbox, or delete its connection. Existing email history is kept.</CardDescription></CardHeader><CardContent><div className="space-y-2">{mailboxError ? <p role="alert" className="text-xs text-destructive">{mailboxError}</p> : mailboxes.length ? mailboxes.map((mailbox) => <MailboxManager key={mailbox.id} mailbox={{ id: mailbox.id, email: mailbox.email, type: mailbox.type, isDefault: mailbox.isDefault, isActive: mailbox.isActive }} />) : <EmptyState compact icon={Mail} title="No mailboxes configured yet." />}</div></CardContent></Card>
          </div>
        ) : null}

        {viewer.role === "admin" && section === "advanced" ? (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="shadow-none">
                <CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Shuffle className="size-4" /></div><div className="flex items-center justify-between gap-3"><div><CardTitle className="text-sm">Automatic assignment</CardTitle><CardDescription className="mt-1 text-xs">New customer and company profiles from Shopify, Meta, and manual creation are assigned immediately.</CardDescription></div><Badge variant={assignmentManagers.length ? "default" : "outline"}>{assignmentManagers.length ? "Active" : "Needs manager"}</Badge></div></CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border bg-muted/30 p-4"><p className="text-sm font-medium">Lowest active workload rule</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The system selects the eligible active BD Manager with the fewest assigned company profiles. The last assignment time breaks ties without moving existing ownership.</p></div>
                  <div className="space-y-2"><div className="flex items-center justify-between"><p className="text-xs font-medium">Eligible BD Managers</p><Badge variant="secondary">{assignmentManagers.length}</Badge></div>{assignmentManagers.length ? assignmentManagers.map((member) => <div key={member.id} className="flex items-center justify-between rounded-md border px-3 py-2"><div className="flex items-center gap-2"><UserRoundCheck className="size-4 text-emerald-600" /><div><p className="text-xs font-medium">{member.displayName || member.email}</p><p className="text-xs text-muted-foreground">Automatic assignment on</p></div></div><CheckCircle2 className="size-4 text-emerald-600" /></div>) : <EmptyState compact icon={UsersRound} title="No eligible BD Managers" description="Enable automatic lead assignment for at least one active BD Manager under Team and access." />}</div>
                </CardContent>
              </Card>

              <Card className="shadow-none">
                <CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg border bg-muted"><Settings2 className="size-4 text-muted-foreground" /></div><CardTitle className="text-sm">Manual assignment</CardTitle><CardDescription className="text-xs">Admins can override ownership for exceptions without disabling the automatic rule.</CardDescription></CardHeader>
                <CardContent className="space-y-4"><div className="rounded-lg border bg-muted/30 p-4"><p className="text-sm font-medium">Account ownership controls</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Open a company profile and choose a BD Manager. The change is recorded while future profiles continue using automatic assignment.</p></div><Button nativeButton={false} variant="outline" render={<Link href="/companies" />}><UsersRound />Open company assignments</Button></CardContent>
              </Card>
            </div>

          </div>
        ) : null}
    </div>
  );
}
