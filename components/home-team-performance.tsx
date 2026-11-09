"use client";

import Link from "next/link";
import { useState } from "react";
import { Info, Settings2, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { useHomeMetrics } from "@/components/use-home-metrics";
import type { HomeData } from "@/lib/home";

const roles: Record<string, string> = { bd_manager: "BD sales manager", admin: "Administrator", operator: "Operator", viewer: "Viewer" };

export function HomeTeamPerformance({ data, refreshing }: { data: HomeData; refreshing: boolean }) {
  const [view, setView] = useState<"bd" | "all">("bd");
  const [openedMember, setOpenedMember] = useState<string | null>(null);
  const preferences = useHomeMetrics(data.preferenceKey);
  const { report } = data;
  const currency = preferences.currency && report.sales.currencies.includes(preferences.currency) ? preferences.currency : report.sales.defaultCurrency;
  const salesFor = (member: typeof report.team[number]) => member.orderValues.find(row => row.currency === currency)?.minor ?? 0;
  const members = report.team.filter(member => view === "all" || member.role === "bd_manager")
    .sort((a, b) => salesFor(b) - salesFor(a) || b.orders - a.orders || a.name.localeCompare(b.name));
  const totalSales = members.reduce((total, member) => total + salesFor(member), 0);
  const customersReady = !data.unavailable.includes("Customers");
  const ordersReady = customersReady && !data.unavailable.includes("Orders");
  const emailsReady = !data.unavailable.includes("Sent emails");
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 });

  if (!data.isAdmin) return null;

  return <section aria-labelledby="home-team-heading" aria-busy={refreshing} className="home-performance space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex items-center gap-1.5"><h2 id="home-team-heading" className="text-sm font-semibold">Team overview</h2>
        <Popover><PopoverTrigger aria-label="About team metrics" className="grid size-7 place-items-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground"><Info className="size-3.5" /></PopoverTrigger><PopoverContent align="start" className="max-w-[calc(100vw-2rem)]"><PopoverTitle>Team metrics</PopoverTitle><PopoverDescription>Uses the date range at the top of the page. Assigned customers are current totals. Sales and orders belong to the current customer owner and exclude drafts and cancellations. Bars show each person’s share of sales among the members shown, in the selected currency.</PopoverDescription></PopoverContent></Popover>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Team performance members" className="flex gap-1 rounded-lg bg-muted/60 p-1">
          {([{ value: "bd", label: "BD managers" }, { value: "all", label: "All members" }] as const).map(item => <button key={item.value} type="button" aria-pressed={view === item.value} onClick={() => { setView(item.value); setOpenedMember(null); }} className={`rounded-md px-2.5 py-1 text-[11px] ${view === item.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{item.label}</button>)}
        </div>
        {report.sales.currencies.length > 1 ? <><label className="sr-only" htmlFor="home-team-currency">Performance currency</label>
        <select id="home-team-currency" value={currency} onChange={event => preferences.save({ metrics: preferences.metrics, currency: event.target.value })} className="h-8 rounded-md border bg-card px-2 text-[11px] focus-visible:outline-2 focus-visible:outline-ring">
          {report.sales.currencies.map(value => <option key={value} value={value}>{value}</option>)}
        </select></> : null}
        <Link href="/settings/team" aria-label="Manage team" title="Manage team" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Settings2 className="size-3.5" /></Link>
      </div>
    </div>

    {members.length ? <div className="home-team-tabs" role="group" aria-label="Team member performance">{members.map(member => {
      const sales = salesFor(member);
      const share = totalSales > 0 ? Math.max(0, Math.min(100, sales / totalSales * 100)) : 0;
      const shareLabel = `${Number(share.toFixed(1))}%`;
      const initials = member.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
      return <Popover key={member.id} open={openedMember === member.id} onOpenChange={open => setOpenedMember(current => open ? member.id : current === member.id ? null : current)}>
        <PopoverTrigger openOnHover delay={150} closeDelay={180} className="home-team-tab" aria-label={`${member.name}, sales ${ordersReady ? `${money.format(sales / 100)} ${currency}` : "unavailable"}. View performance details.`}>
          <Avatar size="sm"><AvatarImage src={member.avatarUrl} alt="" /><AvatarFallback className="bg-brand-soft font-semibold text-primary">{initials}</AvatarFallback></Avatar>
          <span className="home-team-tab-name" data-no-translate>{member.name}</span>
          <span className="home-team-tab-sales" data-no-translate>{ordersReady ? money.format(sales / 100) : "—"}</span>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" sideOffset={8} className="home-team-details !w-[min(320px,calc(100vw-2rem))] !gap-0 !rounded-2xl !p-5">
        <div className="flex items-center gap-3">
          <Avatar className="size-10"><AvatarImage src={member.avatarUrl} alt="" /><AvatarFallback className="bg-brand-soft font-semibold text-primary">{initials}</AvatarFallback></Avatar>
          <div className="min-w-0"><PopoverTitle className="break-words text-sm font-semibold" data-no-translate>{member.name}</PopoverTitle><PopoverDescription className="mt-0.5 text-[11px]">{roles[member.role] ?? "Workspace member"}</PopoverDescription></div>
        </div>

        <div className="mt-5"><div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>Sales</span><span className="text-[10px]" data-no-translate>{currency}</span></div><p className="mt-1 break-words text-[26px] font-semibold leading-tight tracking-tight tabular-nums">{ordersReady ? money.format(sales / 100) : "—"}</p></div>
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px]"><span className="text-muted-foreground">Team sales share</span><span className="font-medium tabular-nums text-primary">{ordersReady ? shareLabel : "—"}</span></div>
          {ordersReady ? <div role="meter" aria-label={`${member.name}: share of selected team sales in ${currency}`} aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} aria-valuetext={shareLabel} className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} /></div> : <div aria-hidden="true" className="h-1 rounded-full bg-muted" />}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
          {[
            { label: "Orders", value: member.orders, ready: ordersReady },
            { label: "New customers", value: member.newCustomers, ready: customersReady },
            { label: "Assigned customers", value: member.customers, ready: customersReady },
            { label: "Emails sent", value: member.emailsSent, ready: emailsReady },
          ].map(metric => <div key={metric.label}><dt className="text-[11px] text-muted-foreground">{metric.label}</dt><dd className="mt-0.5 text-base font-semibold tabular-nums">{metric.ready ? metric.value.toLocaleString() : "—"}</dd></div>)}
        </dl>
        </PopoverContent>
      </Popover>;
    })}</div> : <div className="rounded-xl border border-dashed bg-card px-5 py-10 text-center"><Users aria-hidden="true" className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-xs text-muted-foreground">{data.unavailable.includes("Team members") ? "Team members could not be loaded. Try refreshing." : view === "bd" ? "No active BD managers yet. Add your team in workspace settings." : "Active team members will appear here."}</p></div>}
  </section>;
}
