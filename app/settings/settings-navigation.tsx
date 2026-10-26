"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CreditCard, Mail, Plug, Search, Settings, ShieldCheck, Sun, UserRound, UsersRound, Workflow } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SettingsNavigation({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const groups = [
    { label: "Personal", items: [
      { label: "General", href: "/settings", icon: Settings },
      { label: "Appearance", href: "/settings/appearance", icon: Sun },
      { label: "Profile", href: "/settings/profile", icon: UserRound },
      { label: "Security and login", href: "/settings/security", icon: ShieldCheck },
    ] },
    { label: "Integrations", items: [
      { label: "My mailbox", href: "/settings/mailboxes", icon: Mail },
      { label: "Connected channels", href: "/settings/integrations", icon: Plug },
    ] },
    { label: "Billing", items: [
      { label: "Payment methods", href: "/settings/payments", icon: CreditCard },
    ] },
    ...(isAdmin ? [{ label: "Workspace", items: [
      { label: "Team and access", href: "/settings/team", icon: UsersRound },
      { label: "Assignment and automation", href: "/settings/advanced", icon: Workflow },
    ] }] : []),
  ];
  const filtered = groups.map((group) => ({ ...group, items: group.items.filter((item) => `${item.label} ${group.label}`.toLowerCase().includes(search.trim().toLowerCase())) })).filter((group) => group.items.length);

  return (
    <aside className="shrink-0 border-b bg-muted/10 p-3 md:sticky md:top-12 md:h-[calc(100dvh-3rem)] md:w-64 md:overflow-y-auto md:border-b-0 md:border-r xl:w-72">
      <h1 className="px-3 pb-4 pt-2 text-base font-semibold">Settings</h1>
      <div className="relative mb-4"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search settings" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="h-9 rounded-full border-0 bg-muted pl-9 shadow-none" /></div>
      <nav aria-label="Settings navigation" className="flex gap-5 overflow-x-auto pb-2 md:block md:space-y-6 md:overflow-visible">
        {filtered.map((group) => <div key={group.label} className="shrink-0"><p className="mb-2 px-3 text-xs font-medium text-muted-foreground">{group.label}</p><ul className="space-y-1">{group.items.map((item) => <li key={item.href}><Link href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={`flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${pathname === item.href ? "bg-muted font-medium text-foreground" : "text-foreground/80 hover:bg-muted/60"}`}><item.icon className="size-[18px] shrink-0" />{item.label}</Link></li>)}</ul></div>)}
        {!filtered.length ? <p role="status" className="px-3 text-sm text-muted-foreground">No settings found.</p> : null}
      </nav>
    </aside>
  );
}
