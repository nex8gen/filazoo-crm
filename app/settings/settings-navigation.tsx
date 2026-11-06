"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { useWorkspaceState } from "@/components/workspace-memory";
import { Bot, Building2, ChevronDown, ChevronLeft, CreditCard, LayoutGrid, Mail, MailCheck, Plug, ReceiptText, Search, Settings2, ShieldCheck, Sun, UserRound, UsersRound, Workflow, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { settingsSectionForPath, visibleSettingsSections } from "@/lib/settings-sections";
import "./settings.css";

const icons = { bot: Bot, settings: Settings2, sun: Sun, user: UserRound, shield: ShieldCheck, mailCheck: MailCheck, apps: LayoutGrid, mail: Mail, plug: Plug, creditCard: CreditCard, receipt: ReceiptText, users: UsersRound, workflow: Workflow };

export function SettingsNavigation({ isAdmin, workspaceName }: { isAdmin: boolean; workspaceName: string }) {
  const pathname = usePathname();
  const active = settingsSectionForPath(pathname);
  const [search, setSearch] = useWorkspaceState("settings.search", "");
  const [expanded, setExpanded] = useState(false);
  const [entering, setEntering] = useState(true);
  const filtered = visibleSettingsSections(isAdmin, search);
  const organization = filtered.filter(section => section.id === "workspace" || section.id === "team");
  const workspace = filtered.filter(section => section.id !== "workspace" && section.id !== "team");

  // Finish the entrance once, so searching and switching sections stay immediate.
  useEffect(() => {
    // Effects resume when Next.js reveals a cached layout after a return visit.
    const frame = window.requestAnimationFrame(() => setEntering(true));
    const timeout = window.setTimeout(() => setEntering(false), 2200);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timeout); };
  }, [expanded]);

  function revealStyle(order: number) {
    return { "--settings-reveal-order": order } as CSSProperties;
  }

  function links(sections: typeof filtered, start: number) {
    return <ul className="settings-menu-list">{sections.map((section, index) => {
      const Icon = section.id === "workspace" ? Building2 : icons[section.icon];
      const selected = active?.id === section.id;
      return <li key={section.id} className="settings-reveal-item" style={revealStyle(start + index)}><Link href={section.href} aria-current={selected ? "page" : undefined} onClick={() => { setExpanded(false); setSearch(""); }} className={`settings-menu-link ${selected ? "is-active" : ""}`}><Icon aria-hidden="true" /><span>{section.title}</span></Link></li>;
    })}</ul>;
  }

  return <aside className="settings-navigation" data-entering={entering && !search || undefined}>
    <Link href="/analytics" className="settings-back settings-reveal-item" style={revealStyle(0)}><ChevronLeft aria-hidden="true" className="size-4" /><span>Settings</span></Link>
    <button type="button" aria-expanded={expanded} aria-controls="settings-menu" onClick={() => { setExpanded(!expanded); if (!expanded) setEntering(true); }} className="settings-mobile-toggle">{active?.title || "Settings"}<ChevronDown aria-hidden="true" className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} /></button>
    <div id="settings-menu" className={`settings-menu ${expanded ? "is-expanded" : ""}`}>
      <div className="settings-search settings-reveal-item" style={revealStyle(1)}><Search aria-hidden="true" className="settings-search-icon" /><Input type="search" aria-label="Search settings" value={search} onChange={event => { setEntering(false); setSearch(event.target.value); }} placeholder="Search settings" />{search ? <button type="button" aria-label="Clear settings search" onClick={() => setSearch("")}><X aria-hidden="true" className="size-3.5" /></button> : null}</div>
      <nav aria-label="Settings navigation">
        {organization.length ? <div className="settings-organization"><div className="settings-workspace-label settings-reveal-item" style={revealStyle(2)}><span><strong>{workspaceName}</strong><small>Workspace</small></span><Building2 aria-hidden="true" className="size-4" /></div>{links(organization, 3)}</div> : null}
        {workspace.length ? <div><div className="settings-workspace-label settings-reveal-item" style={revealStyle(3 + organization.length)}><span><strong>{workspaceName}</strong><small>Workspace settings</small></span><span className="settings-workspace-avatar" aria-hidden="true">{workspaceName.slice(0, 3).toUpperCase()}</span></div>{links(workspace, 4 + organization.length)}</div> : null}
        {!filtered.length ? <div role="status" className="settings-no-results"><p>No settings found.</p><p>Try a different keyword.</p><button type="button" onClick={() => setSearch("")}>Clear search</button></div> : null}
      </nav>
    </div>
  </aside>;
}
