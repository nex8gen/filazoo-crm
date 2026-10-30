import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, LockKeyhole } from "lucide-react";
import { requireWorkspaceMember } from "@/lib/auth";
import { connectionApps } from "@/lib/connection-apps";
import { connectionStatusLabel } from "@/lib/app-connection-status";
import { getAppConnectionSummaries } from "@/lib/data/app-connections";
import { SettingsSkeleton } from "@/components/settings-skeleton";
import { Badge } from "@/components/ui/badge";
import { ConnectionAppLogo } from "@/components/connection-app-logo";
import { AppSetup } from "../app-setup";
import { emailProviderSummary } from "@/lib/email-connections";
import { getEmailConnectionsOverview } from "@/lib/data/app-connections";

type Props = { params: Promise<{ appId: string }>; searchParams: Promise<{ scope?: string }> };

export default function AppConnectionPage(props: Props) {
  return <Suspense fallback={<SettingsSkeleton section="apps" />}><AppConnectionWorkspace {...props} /></Suspense>;
}

async function AppConnectionWorkspace({ params, searchParams }: Props) {
  const { appId } = await params;
  const app = connectionApps.find(item => item.id === appId);
  if (!app) notFound();
  const viewer = await requireWorkspaceMember();
  const scope = (await searchParams).scope === "team" ? "workspace" : "personal";
  const isEmailApp = ["gmail", "outlook", "netease-mail"].includes(app.id);
  const [summaries, overview] = await Promise.all([
    getAppConnectionSummaries(),
    isEmailApp ? getEmailConnectionsOverview() : Promise.resolve(null),
  ]);
  const summary = overview ? emailProviderSummary({ ...overview, accounts: overview.accounts.filter(account => account.scope === scope) }, app.id) : summaries[app.id];
  const connected = summary?.status === "connected";
  const isAdmin = viewer.role === "admin";
  const adminRequired = (app.adminOnly || app.scope === "Workspace" || (isEmailApp && scope === "workspace")) && !isAdmin;

  return (
        <div className="settings-content settings-section-enter !max-w-4xl space-y-7">
          <Link href={isEmailApp ? `/settings/apps?view=${scope === "workspace" ? "team" : "personal"}` : "/settings/apps"} className="inline-flex items-center gap-2 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" />Apps & connections</Link>
          <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
            <div className="flex min-w-0 items-start gap-4"><ConnectionAppLogo src={app.logo} large /><div><h1 className="text-xl font-semibold">{app.name}</h1><p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{app.description}</p></div></div>
            <Badge variant="outline" className={connected ? "gap-1.5 border-emerald-600/20 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{connected ? <CheckCircle2 className="size-3.5" /> : null}{connectionStatusLabel(summary?.status ?? "unavailable")}</Badge>
          </header>
          {isEmailApp ? <nav aria-label="Email connection ownership" className="grid gap-3 sm:grid-cols-2">{([
            { value: "personal", title: "My email", description: "Private to your account. Your own inbox and sender." },
            { value: "team", title: "Team email", description: "Shared workspace inbox. Managed by an administrator." },
          ] as const).map(option => <Link key={option.value} href={`/settings/apps/${app.id}?scope=${option.value}`} aria-current={(scope === "workspace" ? "team" : "personal") === option.value ? "page" : undefined} className={`rounded-xl border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring ${(scope === "workspace" ? "team" : "personal") === option.value ? "border-primary/40 bg-primary/5" : "hover:bg-muted/30"}`}><p className="text-sm font-semibold">{option.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</p></Link>)}</nav> : null}
          {summary?.message ? <p className="text-sm text-muted-foreground">{summary.message}</p> : null}
          {adminRequired ? (
            <div className="flex items-start gap-3 rounded-xl border p-5"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><div><h2 className="font-medium">Managed by your administrator</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Ask your workspace administrator to connect or manage {app.name} for your team.</p></div></div>
          ) : <AppSetup app={app} scope={scope} />}
        </div>
  );
}
