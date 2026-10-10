"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Building2,
  ChartNoAxesColumnIncreasing,
  Inbox,
  LayoutDashboard,
  Library,
  Mail,
  Menu,
  Package2,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type NavigationItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  description: string;
  exact?: boolean;
};

type NavigationGroup = {
  label: string;
  eyebrow: string;
  icon: typeof LayoutDashboard;
  items: NavigationItem[];
};

const navigation: NavigationGroup[] = [
  {
    label: "Workspace",
    eyebrow: "CRM",
    icon: LayoutDashboard,
    items: [
      { label: "Overview", href: "/", icon: LayoutDashboard, description: "Performance at a glance" },
      { label: "Companies", href: "/companies", icon: Building2, description: "Accounts and prospects" },
      { label: "Pipeline", href: "/pipeline", icon: ChartNoAxesColumnIncreasing, description: "Deals by stage" },
    ],
  },
  {
    label: "Outreach",
    eyebrow: "Engagement",
    icon: Mail,
    items: [
      { label: "Emails", href: "/emails", icon: Mail, description: "Campaign activity" },
      { label: "Replies", href: "/replies", icon: Inbox, description: "Inbound conversations" },
      { label: "Automation", href: "/automation", icon: Sparkles, description: "Sequences and rules" },
    ],
  },
  {
    label: "Catalogs",
    eyebrow: "Catalog management",
    icon: Library,
    items: [
      { label: "Products", href: "/catalogs", icon: Package2, description: "Products, pricing and availability", exact: true },
      { label: "Company Catalogs", href: "/catalogs/companies", icon: BookOpen, description: "Tailored selections for each company" },
    ],
  },
  {
    label: "Settings",
    eyebrow: "Configuration",
    icon: Settings,
    items: [{ label: "General", href: "/settings", icon: Settings, description: "Profile, security and team" }],
  },
];

const allItems = navigation.flatMap((group) => group.items);
const authPaths = ["/login", "/forgot-password", "/update-password", "/auth/", "/access-denied"];

function itemIsActive(pathname: string, item: NavigationItem) {
  if (item.href === "/" || item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function SidebarNavigation({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const activeGroup = useMemo(
    () => navigation.find((group) => group.items.some((item) => itemIsActive(pathname, item))) ?? navigation[0],
    [pathname],
  );
  const activeItem = activeGroup.items.find((item) => itemIsActive(pathname, item));

  return (
    <div className="relative flex h-full min-h-0 w-[19rem]">
      <aside className="group/rail absolute inset-y-0 left-0 z-20 flex w-12 flex-col overflow-hidden border-r bg-background py-2 transition-[width,box-shadow] duration-200 ease-out md:hover:w-52 md:hover:shadow-lg">
        <nav aria-label="Primary navigation" className="flex flex-1 flex-col gap-1 px-1.5">
          {navigation.map((group) => {
            const active = group.label === activeGroup.label;
            return (
              <Link
                key={group.label}
                href={group.items[0].href}
                aria-label={group.label}
                onClick={onNavigate}
                className={`relative flex h-9 w-9 shrink-0 items-center gap-3 overflow-hidden rounded-md px-2 text-muted-foreground outline-none transition-[width,background-color,color] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:group-hover/rail:w-48 ${active ? "bg-muted text-foreground" : ""}`}
              >
                {active ? <span className="absolute -left-1 top-2 h-5 w-0.5 rounded-r bg-primary" /> : null}
                <group.icon className="size-[17px] shrink-0" />
                <span className="whitespace-nowrap text-sm opacity-0 transition-opacity duration-150 md:group-hover/rail:opacity-100">{group.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mb-2 flex h-8 w-9 shrink-0 items-center gap-3 overflow-hidden px-3 md:group-hover/rail:w-48" title="System operational">
          <span className="size-2 shrink-0 rounded-full bg-primary" />
          <span className="whitespace-nowrap text-xs text-muted-foreground opacity-0 transition-opacity duration-150 md:group-hover/rail:opacity-100">Operational</span>
        </div>
      </aside>

      <aside className="ml-12 flex w-64 shrink-0 flex-col border-r bg-background">
        <div className="flex h-12 items-center border-b px-6">
          <span className="text-sm font-medium">{activeGroup.label}</span>
        </div>
        <nav aria-label={`${activeGroup.label} navigation`} className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          <p className="px-3 pb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{activeGroup.eyebrow}</p>
          <ul className="space-y-0.5">
            {activeGroup.items.map((item) => {
              const active = itemIsActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`group flex min-h-9 items-center gap-3 rounded-md px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-muted font-medium text-foreground" : "text-foreground/80"}`}
                  >
                    <item.icon className={`size-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mx-3 my-5 h-px bg-border" />
          <div className="px-3">
            <p className="text-xs font-medium text-foreground">{activeItem?.label ?? activeGroup.label}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{activeItem?.description ?? "Manage your workspace"}</p>
          </div>
        </nav>
      </aside>
    </div>
  );
}

export function AppShell({ children, userMenu }: { children: React.ReactNode; userMenu?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (authPaths.some((path) => pathname === path || (path.endsWith("/") && pathname.startsWith(path)))) return children;

  const activeItem = allItems.find((item) => itemIsActive(pathname, item)) ?? allItems[0];
  const activeGroup = navigation.find((group) => group.items.includes(activeItem)) ?? navigation[0];
  const navigate = (href: string) => {
    setCommandOpen(false);
    router.push(href);
  };

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-50 flex h-12 items-center border-b bg-background/95 px-3 backdrop-blur md:px-4">
        <Button aria-label="Open navigation" variant="ghost" size="icon-sm" className="mr-2 md:hidden" onClick={() => setMobileOpen(true)}>
          <Menu />
        </Button>
        <Link href="/" aria-label="Filazoo home" className="hidden size-5 items-center justify-center text-primary md:flex">
          <BrandMark className="size-5" />
        </Link>
        <span className="mx-3 hidden text-muted-foreground/40 lg:block">/</span>
        <div className="hidden items-center gap-2 text-xs lg:flex">
          <activeGroup.icon className="size-3.5 text-muted-foreground" />
          <span>{activeGroup.label}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" className="h-8 gap-2 px-2 text-muted-foreground sm:w-52 sm:justify-start" onClick={() => setCommandOpen(true)}>
            <Search className="size-4" />
            <span className="hidden text-xs sm:inline">Search workspace</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 text-[9px] font-normal lg:inline-flex">Ctrl K</kbd>
          </Button>
          <ThemeToggle />
          {userMenu}
        </div>
      </header>

      <div className="fixed inset-y-0 left-0 z-40 hidden pt-12 md:block">
        <SidebarNavigation pathname={pathname} />
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[60] md:hidden">
          <button className="absolute inset-0 bg-black/30" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[calc(100%-3rem)] max-w-[19.5rem] bg-background shadow-xl">
            <Button aria-label="Close navigation" variant="ghost" size="icon-sm" className="absolute right-2 top-2 z-10" onClick={() => setMobileOpen(false)}><X /></Button>
            <SidebarNavigation pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="pt-12 md:pl-[19rem]">
        <main className="min-h-[calc(100svh-3rem)] w-full px-5 py-7 sm:px-7 lg:px-10 lg:py-10">{children}</main>
      </div>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Search pages…" />
        <CommandList>
          <CommandEmpty>No page found.</CommandEmpty>
          {navigation.map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.items.map((item, index) => (
                <CommandItem key={item.href} value={`${group.label} ${item.label}`} onSelect={() => navigate(item.href)}>
                  <item.icon /><span>{item.label}</span><CommandShortcut>{index + 1}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </div>
  );
}
