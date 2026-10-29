"use client";

import Link from "next/link";
import { AiIcon } from "@/components/ai-icon";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Menu, Search } from "lucide-react";
import { navigation, type NavigationItem } from "@/lib/navigation";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { FlowActivityBell } from "@/components/flow-activity-bell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const WorkspaceAiAssistant = lazy(() => import("@/components/workspace-ai-assistant").then((module) => ({ default: module.WorkspaceAiAssistant })));

const WorkspaceCommandMenu = dynamic(() => import("@/components/workspace-command-menu").then((module) => module.WorkspaceCommandMenu));

const allItems = navigation.flatMap((group) => group.items);
const authPaths = [
  "/customer/",
  "/login",
  "/forgot-password",
  "/accept-invitation",
  "/update-password",
  "/auth/",
  "/access-denied",
  "/privacy",
  "/data-deletion",
];

function itemIsActive(pathname: string, item: NavigationItem) {
  if (item.activePrefix && pathname.startsWith(item.activePrefix)) return true;
  if (item.href === "/" || item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function SidebarNavigation({ pathname, onNavigate, userMenu }: { pathname: string; onNavigate?: () => void; userMenu?: React.ReactNode }) {
  const [railExpanded, setRailExpanded] = useState(false);
  const activeGroup = useMemo(
    () => navigation.find((group) => group.items.some((item) => itemIsActive(pathname, item))) ?? navigation[0],
    [pathname],
  );
  const activeItem = activeGroup.items.find((item) => itemIsActive(pathname, item));

  return (
    <div className={`relative flex h-full min-h-0 ${activeGroup.direct ? "w-16" : "w-80"}`}>
      <aside
        data-expanded={railExpanded}
        onPointerEnter={(event) => { if (event.pointerType !== "touch") setRailExpanded(true); }}
        onPointerLeave={() => setRailExpanded(false)}
        onFocusCapture={() => setRailExpanded(true)}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setRailExpanded(false); }}
        className="group/rail absolute inset-y-0 left-0 z-20 flex w-16 flex-col overflow-hidden border-r bg-background py-2 transition-[width,box-shadow] duration-200 ease-out data-[expanded=true]:w-52 data-[expanded=true]:shadow-lg"
      >
        <nav aria-label="Primary navigation" className="flex flex-1 flex-col gap-1 px-2">
          {navigation.map((group) => {
            const active = group.label === activeGroup.label;
            return (
              <Link
                key={group.label}
                href={group.items[0].href}
                aria-label={group.label}
                aria-current={active ? "page" : undefined}
                onClick={() => { setRailExpanded(false); onNavigate?.(); }}
                className={`relative flex h-12 w-12 shrink-0 items-center gap-3 overflow-hidden rounded-md px-[13px] outline-none transition-[width,background-color,color] focus-visible:ring-2 focus-visible:ring-ring group-data-[expanded=true]/rail:w-48 ${group.label === "Settings" ? "mt-auto" : ""} ${active ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                <group.icon className={`mx-0.5 shrink-0 ${group.label === "AI Automation" ? "size-5" : "size-[18px]"} ${active ? "text-primary" : ""}`} />
                <span className="whitespace-nowrap text-sm opacity-0 transition-opacity duration-150 group-data-[expanded=true]/rail:opacity-100">{group.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mx-2 mt-2 flex w-12 shrink-0 items-center justify-center">
          {userMenu}
        </div>
      </aside>

      {!activeGroup.direct ? <aside className="ml-16 flex w-64 shrink-0 flex-col border-r bg-background">
        <div className="flex h-12 items-center border-b px-6">
          <span className="text-sm font-medium">{activeGroup.label}</span>
        </div>
        <nav aria-label={`${activeGroup.label} navigation`} className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-3 py-5">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{activeGroup.eyebrow}</p>
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
                    <item.icon className={`size-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mx-3 my-5 h-px bg-border" />
          <div className="px-3">
            <p className="text-sm font-medium text-foreground">{activeItem?.label ?? activeGroup.label}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{activeItem?.description ?? "Manage your workspace"}</p>
          </div>
        </nav>
      </aside> : null}
    </div>
  );
}

export function AppShell({ children, userMenu }: { children: React.ReactNode; userMenu?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isMessenger = pathname === "/messenger" || pathname.startsWith("/messenger/");
  const isFlowBuilder = pathname === "/lead-channel/ai-agent" || pathname.startsWith("/lead-channel/ai-agent/");
  const isEmails = pathname === "/emails" || pathname.startsWith("/emails/flows");
  const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const usesViewportCanvas = isMessenger || isFlowBuilder || isEmails;
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoaded, setAiLoaded] = useState(false);
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key?.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
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
    <div data-workspace-shell className={`${usesViewportCanvas ? "h-svh overflow-hidden" : "min-h-svh"} bg-background text-foreground`}>
      <a href="#workspace-content" className="sr-only fixed left-4 top-2 z-[100] rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only">Skip to content</a>
      <header className={`fixed left-0 top-0 z-50 flex h-12 items-center border-b bg-background/95 px-3 backdrop-blur md:px-4 ${aiOpen ? "right-0 lg:right-[var(--workspace-ai-width)]" : "right-0"}`}>
        <Button ref={navigationTriggerRef} aria-label="Open navigation" aria-expanded={mobileOpen} variant="ghost" size="icon-sm" className="mr-2 lg:hidden" onClick={() => setMobileOpen(true)}>
          <Menu />
        </Button>
        <Link href="/" aria-label="Filazoo home" className="hidden h-6 items-center justify-center text-primary md:flex">
          <BrandMark className="h-6 w-auto" />
        </Link>
        <span className="min-w-0 truncate text-sm font-semibold md:ml-3 lg:hidden">{activeItem.label}</span>
        <span className="mx-3 hidden text-muted-foreground/40 lg:block">/</span>
        <div className="hidden items-center gap-2 text-xs lg:flex">
          <activeGroup.icon className="size-3.5 text-muted-foreground" />
          <span>{activeGroup.label}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button aria-label="Search workspace" variant="ghost" className="h-8 gap-2 px-2 text-muted-foreground sm:w-60 sm:justify-start" onClick={() => setCommandOpen(true)}>
            <Search className="size-4" />
            <span className="hidden text-xs sm:inline">Search workspace</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 text-xs font-normal lg:inline-flex">Ctrl K</kbd>
          </Button>
          <FlowActivityBell />
          <LanguageSwitcher />
          <ThemeToggle />
          <div className="lg:hidden">{userMenu}</div>
        </div>
      </header>

      <div className="fixed inset-y-0 left-0 z-40 hidden pt-12 lg:block">
        <SidebarNavigation pathname={pathname} userMenu={userMenu} />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" finalFocus={navigationTriggerRef} className="!z-[70] !w-[min(22rem,calc(100%-1rem))] gap-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="border-b pr-14">
            <SheetTitle>Filazoo workspace</SheetTitle>
            <SheetDescription>Accounts, conversations, and sales tools</SheetDescription>
          </SheetHeader>
          <nav aria-label="Workspace navigation" className="space-y-5 p-4">
            {navigation.map((group) => group.direct ? <Link key={group.label} href={group.items[0].href} onClick={() => setMobileOpen(false)} aria-current={itemIsActive(pathname, group.items[0]) ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${itemIsActive(pathname, group.items[0]) ? "bg-brand-soft font-semibold text-primary" : "hover:bg-muted"}`}><group.icon className={`${group.label === "AI Automation" ? "size-5" : "size-4"} shrink-0`} />{group.label}</Link> : <div key={group.label}>
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
              <ul className="space-y-1">{group.items.map((item) => <li key={item.href}>
                <Link href={item.href} onClick={() => setMobileOpen(false)} aria-current={itemIsActive(pathname, item) ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${itemIsActive(pathname, item) ? "bg-brand-soft font-semibold text-primary" : "hover:bg-muted"}`}>
                  <item.icon className="size-4 shrink-0" />{item.label}
                </Link>
              </li>)}</ul>
            </div>)}
          </nav>
        </SheetContent>
      </Sheet>

      <div className={`min-w-0 pt-12 transition-transform duration-300 ease-out ${activeGroup.direct ? "lg:pl-16" : "lg:pl-80"} ${aiOpen ? "max-lg:-translate-x-full lg:mr-[var(--workspace-ai-width)]" : "translate-x-0 lg:mr-0"}`}>
        <main id="workspace-content" tabIndex={-1} className={`${isEmails || isSettings ? "" : "crm-workspace-content"} outline-none ${usesViewportCanvas ? "h-[calc(100dvh-3rem)] min-h-0 w-full overflow-hidden p-0" : isSettings ? "min-h-[calc(100dvh-3rem)] w-full" : "min-h-[calc(100svh-3rem)] w-full px-5 py-7 sm:px-7 lg:px-10 lg:py-10"}`}>{children}</main>
      </div>

      {commandOpen ? (
        <WorkspaceCommandMenu navigation={navigation} open={commandOpen} onOpenChange={setCommandOpen} onNavigate={navigate} />
      ) : null}
      <button type="button" aria-label="Open Filazoo AI" aria-expanded={aiOpen} title="Ask Filazoo AI" onClick={() => { setAiLoaded(true); setAiOpen(true); }} className={`fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-[55] grid size-20 place-items-center text-violet-700 transition duration-200 hover:scale-110 focus-visible:rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:right-7 dark:text-violet-300 ${aiOpen ? "pointer-events-none scale-90 opacity-0" : "opacity-100"}`}><span aria-hidden="true" className="absolute inset-0 rounded-full bg-background/30 backdrop-blur-md" style={{ WebkitMaskImage: "radial-gradient(circle, #000 0%, #000 40%, rgba(0,0,0,.65) 58%, transparent 80%)", maskImage: "radial-gradient(circle, #000 0%, #000 40%, rgba(0,0,0,.65) 58%, transparent 80%)" }} /><span aria-hidden="true" className="absolute inset-2 rounded-full border border-border/80 bg-background/55 shadow-sm" /><AiIcon className="relative z-10 size-12" /></button>
      {/* Keep the panel mounted after its first use so drafts and running work survive closing. */}
      {aiLoaded ? <Suspense fallback={aiOpen ? <aside aria-label="Filazoo AI workspace" className="fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l bg-background lg:top-12 lg:w-[var(--workspace-ai-width)]"><div className="flex items-center justify-between border-b p-4"><span role="status" className="text-sm text-muted-foreground">Loading…</span><Button variant="ghost" size="sm" onClick={() => setAiOpen(false)}>Close</Button></div></aside> : null}><WorkspaceAiAssistant open={aiOpen} onOpenChange={setAiOpen} /></Suspense> : null}
    </div>
  );
}
