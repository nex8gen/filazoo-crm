"use client";

import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { BrandMark, BrandMarkIcon } from "@/components/brand-mark";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { navigation, type NavigationGroup, type NavigationItem } from "@/lib/navigation";
import { AiUsageShortcut } from "@/components/ai-usage-shortcut";

const sidebarStorageKey = "filazoo:sidebar-expanded:v1";
const sidebarChangeEvent = "filazoo:sidebar-changed";
const desktopQuery = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getDesktop() { return window.matchMedia(desktopQuery).matches; }

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(sidebarChangeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(sidebarChangeEvent, onChange);
  };
}

export function useWorkspaceSidebar(storageKey = sidebarStorageKey) {
  const getExpanded = useCallback(() => {
    try { return window.localStorage.getItem(storageKey) !== "false"; }
    catch { return true; }
  }, [storageKey]);
  const expanded = useSyncExternalStore(subscribe, getExpanded, () => true);
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktop, () => false);
  // Storage may be disabled by browser policy; keep the toggle usable in that case.
  const [fallback, setFallback] = useState<boolean | null>(null);
  const toggle = useCallback(() => {
    const next = !(fallback ?? expanded);
    try {
      window.localStorage.setItem(storageKey, String(next));
      window.dispatchEvent(new Event(sidebarChangeEvent));
    } catch { setFallback(next); }
  }, [expanded, fallback, storageKey]);
  return { expanded: fallback ?? expanded, toggle, isDesktop };
}

export function itemIsActive(pathname: string, item: NavigationItem) {
  if (item.excludePrefixes?.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  if (item.activePrefix && pathname.startsWith(item.activePrefix)) return true;
  if (item.href === "/" || item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function SidebarItemLabel({ item, label = item.label }: { item: NavigationItem; label?: string }) {
  return (
    <span className="workspace-sidebar-label flex min-w-0 items-center gap-2">
      <span className="truncate">{label}</span>
      {item.badge ? <span className="shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-xs font-medium leading-4 text-primary">{item.badge}</span> : null}
    </span>
  );
}

function SidebarGroupFlyout({ group, pathname, rowClass }: { group: NavigationGroup; pathname: string; rowClass: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={group.label} openOnHover delay={100} closeDelay={180} className={rowClass}>
        <group.icon aria-hidden="true" className="size-[18px] shrink-0" />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={24} className="workspace-sidebar-flyout">
        <PopoverTitle className="sr-only">{group.label}</PopoverTitle>
        <nav aria-label={`${group.label} navigation`}>
          {group.items.map(item => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={itemIsActive(pathname, item) ? "page" : undefined} className={`workspace-sidebar-subitem ${itemIsActive(pathname, item) ? "is-active" : ""}`}>
              <SidebarItemLabel item={item} />
            </Link>
          ))}
        </nav>
      </PopoverContent>
    </Popover>
  );
}

function SidebarGroup({ group, pathname, expanded }: { group: NavigationGroup; pathname: string; expanded: boolean }) {
  const active = group.items.some(item => itemIsActive(pathname, item));
  const rowActive = expanded && group.nested ? itemIsActive(pathname, group.items[0]) : active;
  const rowClass = `workspace-sidebar-row ${rowActive ? "is-active" : ""}`;
  const icon = <group.icon aria-hidden="true" className="size-[18px] shrink-0" />;

  const collapsedRow = !group.direct ? <SidebarGroupFlyout group={group} pathname={pathname} rowClass={rowClass} /> : null;

  const link = (
    <Link href={group.items[0].href} aria-label={[group.label, group.items[0].badge].filter(Boolean).join(" ")} aria-current={itemIsActive(pathname, group.items[0]) ? "page" : undefined} className={rowClass}>
      {icon}
      <SidebarItemLabel item={group.items[0]} label={group.label} />
    </Link>
  );

  return (
    <li data-sidebar-section-start={group.sectionStart || undefined}>
      {expanded ? link : collapsedRow ?? <Tooltip><TooltipTrigger render={link} /><TooltipContent side="right" sideOffset={24} className="workspace-sidebar-tooltip"><SidebarItemLabel item={group.items[0]} label={group.label} /></TooltipContent></Tooltip>}
      {active && !group.direct ? <>
        <div className="workspace-sidebar-submenu-reveal" inert={!expanded || undefined} aria-hidden={!expanded || undefined}>
          <div className="workspace-sidebar-submenu-clip">
            <ul className="workspace-sidebar-submenu">
              {group.items.filter(item => item.href !== group.items[0].href).map(item => (
                <li key={item.href}>
                  <Link href={item.href} aria-current={itemIsActive(pathname, item) ? "page" : undefined} className={`workspace-sidebar-subitem ${itemIsActive(pathname, item) ? "is-active" : ""}`}>
                    <SidebarItemLabel item={item} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div aria-hidden="true" className="workspace-sidebar-collapsed-indicator"><div data-active={group.items.slice(1).some(item => itemIsActive(pathname, item)) || undefined} className="workspace-sidebar-submenu workspace-sidebar-submenu-collapsed" /></div>
      </> : null}
    </li>
  );
}

export function WorkspaceSidebar({ pathname, expanded, onToggle, onSearch, userMenu, activity }: {
  pathname: string;
  expanded: boolean;
  onToggle: () => void;
  onSearch: () => void;
  userMenu?: ReactNode;
  activity?: ReactNode;
}) {
  const settings = navigation.find(group => group.label === "Settings");
  return (
    <aside id="workspace-sidebar" aria-label="Workspace sidebar" data-expanded={expanded} className="workspace-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col lg:flex">
      <div className="workspace-sidebar-header flex h-14 shrink-0 items-center gap-2 px-2">
        <Link href="/analytics" aria-label="NewAI home" inert={!expanded || undefined} aria-hidden={!expanded || undefined} className="workspace-sidebar-home flex min-w-0 flex-1 items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BrandMark aria-hidden="true" className="h-auto w-full min-w-0 max-w-[166px]" />
        </Link>
        <Tooltip>
          <TooltipTrigger render={<button type="button" aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={expanded} aria-controls="workspace-sidebar" aria-keyshortcuts="Control+B Meta+B" onClick={onToggle} className="workspace-sidebar-brand-toggle">
            <BrandMarkIcon aria-hidden="true" className="workspace-sidebar-brand-mark size-7" />
            <PanelLeftOpen aria-hidden="true" className="workspace-sidebar-toggle-icon size-5" />
            <PanelLeftClose aria-hidden="true" className="workspace-sidebar-close-icon size-4" />
          </button>} />
          <TooltipContent side="right" sideOffset={20}>{expanded ? "Collapse" : "Expand"} sidebar (Ctrl+B)</TooltipContent>
        </Tooltip>
      </div>
      <div className="workspace-sidebar-search-frame mb-4 px-2">
        <button type="button" aria-label="Search workspace" onClick={onSearch} className="workspace-sidebar-row workspace-sidebar-search">
          <Search aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="workspace-sidebar-label">Search</span><kbd className="workspace-sidebar-label ml-auto whitespace-nowrap font-sans text-[length:var(--ui-text-meta)] font-normal text-muted-foreground">ctrl+k</kbd>
        </button>
      </div>
      <nav aria-label="Primary navigation" className="workspace-sidebar-navigation scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        <ul className="space-y-0.5">
          {navigation.filter(group => group.label !== "Settings").map(group => <SidebarGroup key={`${group.label}:${pathname}`} group={group} pathname={pathname} expanded={expanded} />)}
        </ul>
      </nav>
      <div className="workspace-sidebar-utility shrink-0 px-2 pb-2"><AiUsageShortcut expanded={expanded} /></div>
      <div className="workspace-sidebar-footer shrink-0 space-y-1 border-t border-[var(--workspace-frame-border)] px-2 pb-2 pt-2">
        {settings ? <nav aria-label="Settings navigation"><ul><SidebarGroup group={settings} pathname={pathname} expanded={expanded} /></ul></nav> : null}
        {activity}
        <div className="flex min-h-11 items-center gap-2 overflow-hidden rounded-lg text-[var(--workspace-rail-text)] [&_button]:size-10 [&_button]:shrink-0 [&_button]:p-1 [&_button]:text-[var(--workspace-rail-text)] [&_button:hover]:bg-[var(--workspace-rail-hover)] [&_button[data-popup-open]]:bg-[var(--workspace-rail-hover)]">
          {userMenu}
          <span className="workspace-sidebar-label truncate text-sm">Filazoo workspace</span>
        </div>
      </div>
    </aside>
  );
}
