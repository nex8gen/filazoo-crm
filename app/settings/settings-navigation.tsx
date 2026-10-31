"use client";

import Link from "next/link";
import { Bot } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useWorkspaceState } from "@/components/workspace-memory";
import { ChevronDown, ChevronRight, CreditCard, LayoutGrid, Mail, MailCheck, Plug, ReceiptText, Search, Settings2, ShieldCheck, Sun, UserRound, UsersRound, Workflow, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { settingsSectionForPath, visibleSettingsSections } from "@/lib/settings-sections";
import "./settings.css";

const icons = { bot: Bot, settings: Settings2, sun: Sun, user: UserRound, shield: ShieldCheck, mailCheck: MailCheck, apps: LayoutGrid, mail: Mail, plug: Plug, creditCard: CreditCard, receipt: ReceiptText, users: UsersRound, workflow: Workflow };

export function SettingsNavigation({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const active = settingsSectionForPath(pathname);
  const [search, setSearch] = useWorkspaceState("settings.search", "");
  const [expanded, setExpanded] = useState(false);
  const filtered = visibleSettingsSections(isAdmin, search);
  const groups = [...new Set(filtered.map(section => section.group))];

  return <aside className="settings-navigation shrink-0 border-b bg-muted/20 p-4 md:sticky md:top-12 md:h-[calc(100dvh-3rem)] md:w-60 md:overflow-y-auto md:border-b-0 md:border-r lg:w-64 lg:p-5">
    <div className="mb-5 flex items-center gap-2.5 px-2"><span className="grid size-9 place-items-center rounded-xl border bg-background shadow-xs"><Settings2 aria-hidden="true" className="size-[18px] text-primary" /></span><div><h1 className="text-base font-semibold tracking-tight">Settings</h1><p className="text-xs text-muted-foreground">Your workspace, your way</p></div></div>
    <button type="button" aria-expanded={expanded} aria-controls="settings-menu" onClick={() => setExpanded(!expanded)} className="flex min-h-11 w-full items-center justify-between rounded-xl border bg-background px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden">{active?.title || "Settings"}<ChevronDown aria-hidden="true" className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} /></button>
    <div id="settings-menu" className={`${expanded ? "block" : "hidden"} mt-4 md:mt-0 md:block`}>
      <div className="relative mb-6"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input type="search" aria-label="Search settings" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search settings…" className="h-10 rounded-xl bg-background pl-9 pr-9 shadow-xs" />{search ? <button type="button" aria-label="Clear settings search" onClick={() => setSearch("")} className="absolute right-0 top-0 grid size-10 place-items-center rounded-xl text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><X aria-hidden="true" className="size-3.5" /></button> : null}</div>
      <nav aria-label="Settings navigation" className="space-y-6">
        {groups.map(group => <div key={group}><p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group}</p><ul className="space-y-1">{filtered.filter(section => section.group === group).map(section => {
          const Icon = icons[section.icon];
          const selected = active?.id === section.id;
          return <li key={section.id}><Link href={section.href} aria-current={selected ? "page" : undefined} onClick={() => { setExpanded(false); setSearch(""); }} className={`group flex min-h-10 items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon aria-hidden="true" className="size-[17px] shrink-0" /><span className="flex-1">{section.title}</span>{selected ? <ChevronRight aria-hidden="true" className="size-3.5" /> : null}</Link></li>;
        })}</ul></div>)}
        {!filtered.length ? <div role="status" className="space-y-3 rounded-xl border border-dashed p-4 text-center"><p className="text-sm font-medium">No settings found.</p><p className="text-xs text-muted-foreground">Try a setting name or a keyword.</p><button type="button" className="text-xs font-medium text-primary underline underline-offset-4" onClick={() => setSearch("")}>Clear search</button></div> : null}
      </nav>
      <p className="mt-8 border-t px-3 pt-4 text-xs leading-5 text-muted-foreground">Personal settings apply to you. Workspace settings are shared with your team.</p>
    </div>
  </aside>;
}
