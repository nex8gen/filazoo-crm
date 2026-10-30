"use client";

import { startTransition, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, LayoutGrid, LoaderCircle, LockKeyhole, Mail, Plus, UserRound, UsersRound } from "lucide-react";
import { ConnectionAppLogo } from "@/components/connection-app-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { connectionApps } from "@/lib/connection-apps";
import { connectionStatusLabel, type AppConnectionSummary } from "@/lib/app-connection-status";
import { emailProviderHref, type EmailConnectionAccount, type EmailConnectionsOverview, type EmailConnectionsView, type EmailConnectionScope } from "@/lib/email-connections";
import { AppsConnections } from "../apps-connections";
import { setEmailConnectionActive } from "./email-account-actions";

function ConnectEmail({ scope }: { scope: EmailConnectionScope }) {
  return <Dialog>
    <DialogTrigger render={<Button size="sm" />}><Plus />Connect email</DialogTrigger>
    <DialogContent className="gap-5 p-6 sm:max-w-lg">
      <DialogHeader><DialogTitle>Connect {scope === "workspace" ? "team" : "personal"} email</DialogTitle><DialogDescription>{scope === "workspace" ? "Add a shared inbox for customer enquiries and team conversations." : "Add your own sales email. Only you can access this personal connection."}</DialogDescription></DialogHeader>
      <div className="space-y-3">{connectionApps.filter(app => ["gmail", "netease-mail"].includes(app.id)).map(app => <Link key={app.id} href={emailProviderHref(app.id, scope)} className="flex items-center gap-3 rounded-xl border p-4 outline-none hover:border-primary/30 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"><ConnectionAppLogo src={app.logo} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{app.name}</p><p className="mt-1 text-xs text-muted-foreground">{app.id === "gmail" ? "Gmail or Google Workspace" : "NetEase Lingxi Office"}</p></div><ArrowRight className="size-4 shrink-0 text-muted-foreground" /></Link>)}</div>
      <p className="text-xs leading-5 text-muted-foreground">Choose your provider, then test and save the connection. Existing accounts and default senders stay in place.</p>
    </DialogContent>
  </Dialog>;
}

function AccountRow({ account, canManage }: { account: EmailConnectionAccount; canManage: boolean }) {
  const [state, action, pending] = useActionState(setEmailConnectionActive, undefined);
  const provider = connectionApps.find(app => app.id === account.providerId);
  return <article className="space-y-3 border-t p-4 first:border-t-0 sm:p-5">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 items-center gap-3.5">
        {provider ? <ConnectionAppLogo src={provider.logo} /> : <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted"><Mail className="size-5 text-muted-foreground" /></span>}
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{account.name}</h3>{account.isDefault ? <Badge variant="secondary">{account.scope === "workspace" ? "Default team sender" : "Default personal sender"}</Badge> : null}</div><p className="mt-1 break-all text-sm text-muted-foreground">{account.email}</p><p className="mt-1 text-xs text-muted-foreground">{provider?.name ?? "SMTP / IMAP"}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        <Badge variant="outline" className={account.status === "connected" ? "border-emerald-600/20 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{account.status === "connected" ? <CheckCircle2 /> : null}{connectionStatusLabel(account.status)}</Badge>
        <Button nativeButton={false} render={<Link href={`/emails?mailbox=${encodeURIComponent(account.id)}`} />} variant="outline" size="sm">Open inbox<ArrowRight /></Button>
        {canManage && provider ? <Button nativeButton={false} render={<Link href={`${emailProviderHref(provider.id, account.scope)}#account-${account.id}`} />} variant="ghost" size="sm" aria-label={`Manage ${account.email}`}>Manage</Button> : null}
        {canManage ? <div className="flex items-center gap-2">{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-muted-foreground" /> : null}<Switch checked={account.isActive} disabled={pending} aria-label={`Sending and syncing: ${account.email}`} onCheckedChange={enabled => { const data = new FormData(); data.set("id", account.id); data.set("scope", account.scope); data.set("operation", enabled ? "resume" : "pause"); startTransition(() => action(data)); }} /></div> : null}
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{!account.isActive ? "Paused. Saved emails and credentials are kept." : account.sendConfigured && account.inboxConfigured ? "Sending and receiving are configured." : `Setup needed: ${[!account.sendConfigured ? "sending" : "", !account.inboxConfigured ? "receiving" : ""].filter(Boolean).join(" and ")}.`}</p>
    {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
    {state?.success ? <p role="status" className="text-xs text-primary">{state.success}</p> : null}
  </article>;
}

function AccountsPanel({ scope, overview, isAdmin }: { scope: EmailConnectionScope; overview: EmailConnectionsOverview; isAdmin: boolean }) {
  const accounts = overview.accounts.filter(account => account.scope === scope);
  const canManage = scope === "personal" || isAdmin;
  const Icon = scope === "personal" ? UserRound : UsersRound;
  return <div className="space-y-6 pt-3">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{scope === "personal" ? "My email accounts" : "Team email accounts"}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{scope === "personal" ? "Your own sales inboxes and sending accounts. Personal email is private to you." : "Shared inboxes for customer enquiries and team conversations. Administrators manage these connections."}</p></div>{canManage && accounts.length > 0 && !overview.error ? <ConnectEmail scope={scope} /> : null}</div>
    <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-4"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><p className="text-sm leading-6 text-muted-foreground">{scope === "personal" ? "Connect a mailbox here to read and reply from your own address. Adding an account keeps your current default sender." : "Team email follows existing customer-access rules. Adding a team inbox keeps the current default team sender."}</p></div>
    {overview.error ? <p role="alert" className="rounded-xl border border-destructive/20 p-5 text-sm text-destructive">{overview.error}</p> : accounts.length ? <div className="overflow-hidden rounded-xl border bg-card">{accounts.map(account => <AccountRow key={account.id} account={account} canManage={canManage} />)}</div> : <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-5 py-14 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-muted"><Icon className="size-6 text-muted-foreground" /></span><h3 className="font-medium">{scope === "personal" ? "Connect your first personal email" : "No team email accounts yet"}</h3><p className="mb-1 max-w-md text-sm leading-6 text-muted-foreground">{scope === "personal" ? "Bring your sales conversations into the CRM with Gmail or Lingxi Mail." : canManage ? "Add a shared address for your team's customer conversations." : "Your administrator can add a shared inbox for the team."}</p>{canManage ? <ConnectEmail scope={scope} /> : null}</div>}
    {scope === "workspace" && !isAdmin ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="size-3.5" />Contact your administrator to add or update a team connection.</p> : null}
  </div>;
}

export function EmailConnectionsHub({ connections, overview, isAdmin, initialView }: {
  connections: Record<string, AppConnectionSummary>; overview: EmailConnectionsOverview; isAdmin: boolean; initialView: EmailConnectionsView;
}) {
  const requestedView = useSearchParams().get("view");
  const view = requestedView === "apps" || requestedView === "personal" || requestedView === "team" ? requestedView : initialView;
  return <Tabs value={view} onValueChange={value => {
    if (value !== "apps" && value !== "personal" && value !== "team") return;
    window.history.replaceState(null, "", `/settings/apps?view=${value}`);
  }} className="gap-6">
    <TabsList aria-label="Apps and email connections" variant="line" className="h-auto w-full flex-wrap justify-start gap-3 border-b pb-2 sm:gap-5">
      <TabsTrigger value="apps" className="flex-none px-2 py-2"><LayoutGrid />App library</TabsTrigger>
      <TabsTrigger value="personal" className="flex-none px-2 py-2"><UserRound />My email<Badge variant="secondary">{overview.accounts.filter(account => account.scope === "personal").length}</Badge></TabsTrigger>
      <TabsTrigger value="team" className="flex-none px-2 py-2"><UsersRound />Team email<Badge variant="secondary">{overview.accounts.filter(account => account.scope === "workspace").length}</Badge></TabsTrigger>
    </TabsList>
    <TabsContent value="apps"><AppsConnections connections={connections} /></TabsContent>
    <TabsContent value="personal"><AccountsPanel scope="personal" overview={overview} isAdmin={isAdmin} /></TabsContent>
    <TabsContent value="team"><AccountsPanel scope="workspace" overview={overview} isAdmin={isAdmin} /></TabsContent>
  </Tabs>;
}
