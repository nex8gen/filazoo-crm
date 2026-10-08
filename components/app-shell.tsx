"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/icon";

const navigation: { href: string; label: string; icon: IconName; badge?: string }[] = [
  { href: "/", label: "Overview", icon: "grid" },
  { href: "/companies", label: "Companies", icon: "building", badge: "248" },
  { href: "/pipeline", label: "Pipeline", icon: "pipeline" },
  { href: "/emails", label: "Email queue", icon: "mail", badge: "12" },
  { href: "/catalog", label: "Catalog", icon: "catalog" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return <div className="app-shell">
    <button className="mobile-menu" aria-label="Open navigation" onClick={() => setOpen(true)}><Icon name="menu" /></button>
    {open && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? "is-open" : ""}`}>
      <div className="brand"><span className="brand-mark">F</span><div><strong>filazoo</strong><small>BUSINESS CRM</small></div></div>
      <nav className="primary-nav" aria-label="Primary navigation">
        <p className="nav-label">WORKSPACE</p>
        {navigation.map((item) => { const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href); return <Link className={active ? "active" : ""} href={item.href} key={item.href} onClick={() => setOpen(false)}><Icon name={item.icon}/><span>{item.label}</span>{item.badge && <small>{item.badge}</small>}</Link>; })}
        <p className="nav-label nav-label-spaced">SYSTEM</p>
        <Link className={pathname.startsWith("/settings") ? "active" : ""} href="/settings" onClick={() => setOpen(false)}><Icon name="settings"/><span>Settings</span></Link>
      </nav>
      <div className="safety-card"><span className="safety-dot"/><div><strong>Dry run is on</strong><p>No emails will be sent</p></div></div>
      <div className="sidebar-profile"><span className="profile-avatar">FZ</span><div><strong>Filazoo team</strong><small>Admin workspace</small></div><button aria-label="Open account menu">•••</button></div>
    </aside>
    <main className="main-content">{children}</main>
  </div>;
}
