"use client";

import { useWorkspaceState } from "@/components/workspace-memory";
import Link from "next/link";
import { ArrowUpRight, Check, Clock3, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectionAppLogo } from "@/components/connection-app-logo";
import { appCategories, connectionApps, type Category } from "@/lib/connection-apps";
import { connectionStatusLabel, type AppConnectionSummary } from "@/lib/app-connection-status";
import { emailProviderHref } from "@/lib/email-connections";

type Filter = "available" | "connected" | "planned";
const filters: { value: Filter; label: string }[] = [
  { value: "available", label: "Available apps" },
  { value: "connected", label: "Connected" },
  { value: "planned", label: "Coming soon" },
];

export function AppsConnections({ connections }: { connections: Record<string, AppConnectionSummary> }) {
  const [query, setQuery] = useWorkspaceState("settings.apps.query", "");
  const [filter, setFilter] = useWorkspaceState<Filter>("settings.apps.filter", "available");
  const [category, setCategory] = useWorkspaceState<Category | "all">("settings.apps.category", "all");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredApps = connectionApps.filter((app) =>
    (filter === "available" ? app.availability === "existing" : filter === "connected" ? connections[app.id]?.status === "connected" : app.availability === "planned")
    && (category === "all" || app.category === category)
    && `${app.name} ${app.category} ${app.description} ${app.keywords ?? ""}`.toLowerCase().includes(normalizedQuery),
  );

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div role="group" aria-label="Filter apps by connection" className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-muted/60 p-1">
          {filters.map((item) => (
            <Button key={item.value} size="sm" variant="ghost" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}
              className={filter === item.value ? "bg-background shadow-sm hover:bg-background" : "text-muted-foreground"}>{item.label}</Button>
          ))}
        </div>
        <div className="relative w-full xl:max-w-xs">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search apps" placeholder="Search apps..." className="h-10 rounded-xl pl-9" />
        </div>
      </div>
      <div role="group" aria-label="Filter apps by category" className="flex flex-wrap gap-2">
        {(["all", ...appCategories] as const).map((item) => (
          <Button key={item} variant={category === item ? "secondary" : "ghost"} size="sm" aria-pressed={category === item} onClick={() => setCategory(item)} className="rounded-full">
            {item === "all" ? "All categories" : item}
          </Button>
        ))}
      </div>
      <p role="status" className="text-xs text-muted-foreground">{filteredApps.length} {filteredApps.length === 1 ? "app" : "apps"}{normalizedQuery ? ` matching "${query.trim()}"` : " to explore"}</p>
      {filteredApps.length ? (
        <div className="space-y-9">
          {appCategories.map((section) => {
            const sectionApps = filteredApps.filter((app) => app.category === section);
            if (!sectionApps.length) return null;
            return (
              <section key={section} aria-label={`${section} apps`}>
                <div className="mb-4 flex items-center gap-2.5"><h2 className="text-base font-semibold">{section}</h2><span className="text-xs text-muted-foreground">{sectionApps.length}</span></div>
                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                  {sectionApps.map((app) => {
                    const summary = connections[app.id];
                    const connected = summary?.status === "connected";
                    const href = summary?.personalCount !== undefined
                      ? emailProviderHref(app.id, !summary.personalCount && summary.teamCount ? "workspace" : "personal")
                      : `/settings/apps/${app.id}`;
                    const emailCounts = [summary?.personalCount ? `${summary.personalCount} personal` : "", summary?.teamCount ? `${summary.teamCount} team` : ""].filter(Boolean).join(" · ");
                    return (
                      <article key={app.id} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-foreground/20">
                        <div className="flex items-start gap-3.5">
                          <ConnectionAppLogo src={app.logo} />
                          <div className="min-w-0"><h3 className="text-sm font-semibold"><Link href={href} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{app.name}</Link></h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{app.description}</p></div>
                        </div>
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                          <Badge variant="outline" className="text-muted-foreground">{connected ? emailCounts || app.scope : app.availability === "planned" ? "Coming soon" : connectionStatusLabel(summary?.status ?? "unavailable")}</Badge>
                          <Button nativeButton={false} render={<Link href={href} />} size="sm" variant={connected || app.availability === "planned" ? "outline" : "default"}
                            aria-label={`${app.availability === "planned" ? "View details" : connected ? "Manage" : "Connect"}: ${app.name}`} className={connected ? "border-emerald-600/20 text-emerald-700 dark:text-emerald-400" : ""}>
                            {app.availability === "planned" ? <Clock3 /> : connected ? <Check /> : <Plus />}{app.availability === "planned" ? "View details" : connected ? "Manage" : "Connect"}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-5 py-14 text-center">
          <Search aria-hidden="true" className="size-7 text-muted-foreground" /><h2 className="font-medium">No apps found</h2>
          <p className="text-sm text-muted-foreground">Try a different search or clear your filters.</p>
          <Button variant="outline" size="sm" onClick={() => { setQuery(""); setFilter("available"); setCategory("all"); }}>Clear filters</Button>
        </div>
      )}
      <section className="border-t pt-6" aria-labelledby="settings-workflows"><h2 id="settings-workflows" className="text-sm font-semibold">Related workspaces</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{[{ label: "Delivery checks", href: "/deliverability" }, { label: "Manage automation", href: "/lead-channel/ai-agent" }, { label: "Manage products", href: "/catalogs" }, { label: "Company catalogs", href: "/catalogs/companies" }].map(link => <Link key={link.href} href={link.href} className="flex min-h-11 items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">{link.label}<ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" /></Link>)}</div></section>
    </div>
  );
}
