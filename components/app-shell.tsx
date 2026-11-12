"use client";

import Link from "next/link";
import { AiLauncher } from "@/components/ai-launcher";
import type { WorkspaceAiLaunchRequest } from "@/components/workspace-ai-assistant";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Menu, Search } from "lucide-react";
import { navigation } from "@/lib/navigation";
import { FlowActivityBell } from "@/components/flow-activity-bell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useVisitedPageRefresh } from "@/components/use-visited-page-refresh";
import { useCustomerTagRefresh } from "@/components/use-customer-tag-refresh";
import { WorkspaceSidebar, itemIsActive, useWorkspaceSidebar } from "@/components/workspace-sidebar";
import { isStandaloneRoute } from "@/lib/standalone-routes";
import { WorkspacePageHeader } from "@/components/workspace-page-header";
import { WorkspaceTableHeaders } from "@/components/workspace-table-headers";
import { PageHeaderProvider } from "@/components/page-header";
import { workspaceAiLaunchEvent, type WorkspaceAiLaunchDetail } from "@/lib/ai/launch";

const loadAiAssistant = () => import("@/components/workspace-ai-assistant");
const WorkspaceAiAssistant = lazy(() => loadAiAssistant().then((module) => ({ default: module.WorkspaceAiAssistant })));

const WorkspaceCommandMenu = dynamic(() => import("@/components/workspace-command-menu").then((module) => module.WorkspaceCommandMenu));

export function AppShell({ children, userMenu }: { children: React.ReactNode; userMenu?: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const router = useRouter();
  const isPurchaseOrders = pathname === "/purchase-orders" || pathname.startsWith("/purchase-orders/");
  const { expanded: sidebarExpanded, toggle: toggleSidebar, isDesktop } = useWorkspaceSidebar(isPurchaseOrders ? "filazoo:po-sidebar-expanded:v1" : undefined);
  const isMessenger = pathname === "/messenger" || pathname.startsWith("/messenger/");
  const isFlowBuilder = pathname === "/workflow" || pathname === "/workflow/qa" || pathname.startsWith("/workflow/qa/");
  const isEmails = pathname === "/email" || pathname.startsWith("/email/workflows") || pathname === "/email/campaigns";
  const isDocuments = pathname === "/documents";
  const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const [settingsSidebarExpanded, setSettingsSidebarExpanded] = useState(false);
  const effectiveSidebarExpanded = isSettings ? settingsSidebarExpanded : sidebarExpanded;
  const toggleVisibleSidebar = useCallback(() => {
    if (isSettings) setSettingsSidebarExpanded(value => !value);
    else toggleSidebar();
  }, [isSettings, toggleSidebar]);
  const usesViewportCanvas = isMessenger || isFlowBuilder || isEmails || isDocuments;
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const pageAiOpen = aiOpen && isHome;
  const sidebarAiOpen = aiOpen && !isHome;
  const [aiLoaded, setAiLoaded] = useState(false);
  const [aiLaunchRequest, setAiLaunchRequest] = useState<WorkspaceAiLaunchRequest>({ id: 0, mode: "chat" });
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const isPublicPage = isStandaloneRoute(pathname);
  useCustomerTagRefresh(!isPublicPage);
  // Inbox and automation already refresh their own data in place.
  useVisitedPageRefresh(pathname, !isPublicPage && !usesViewportCanvas);

  useEffect(() => {
    if (isPublicPage) return;
    const launch = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceAiLaunchDetail>).detail;
      if (!detail || !["chat", "agent"].includes(detail.mode)) return;
      setAiLaunchRequest(current => ({ id: current.id + 1, mode: detail.mode, prompt: detail.prompt?.slice(0, 6_000), submit: isHome && detail.submit === true }));
      setAiLoaded(true);
      setAiOpen(true);
    };
    window.addEventListener(workspaceAiLaunchEvent, launch);
    return () => window.removeEventListener(workspaceAiLaunchEvent, launch);
  }, [isPublicPage, isHome]);

  useEffect(() => {
    if (isPublicPage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || Boolean(event.target.closest("input, textarea, select")));
      if (!editing && !event.defaultPrevented && event.key?.toLowerCase() === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (window.matchMedia("(min-width: 1024px)").matches) toggleVisibleSidebar();
        else setMobileOpen(open => !open);
      }
      if (event.key?.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPublicPage, toggleVisibleSidebar]);

  if (isPublicPage) return children;

  const navigate = (href: string) => {
    setCommandOpen(false);
    router.push(href);
  };
  const changeAiOpen = (next: boolean) => {
    setAiOpen(next);
    if (!next && isHome) requestAnimationFrame(() => document.getElementById("home-ai-question")?.focus());
  };
  const AiContainer = isHome ? "main" : "aside";

  return (
    <div data-workspace-shell data-email-workspace={pathname === "/email" || undefined} data-settings={isSettings || undefined} style={{ "--workspace-sidebar-width": effectiveSidebarExpanded ? "14.5rem" : "3.5rem" } as CSSProperties} className={`${usesViewportCanvas || aiOpen ? "h-dvh overflow-hidden" : "min-h-svh"} bg-background text-foreground lg:bg-[#0b0b0b]`}>
      <a href={pageAiOpen ? "#workspace-ai-content" : "#workspace-content"} className="sr-only fixed left-4 top-2 z-[100] rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only">Skip to content</a>
      <Button ref={navigationTriggerRef} aria-label="Open navigation" aria-expanded={mobileOpen} variant="outline" size="icon" className="fixed bottom-4 left-4 z-50 rounded-full bg-background shadow-md lg:hidden" onClick={() => setMobileOpen(true)}><Menu /></Button>

      <WorkspaceSidebar pathname={pathname} expanded={effectiveSidebarExpanded} onToggle={toggleVisibleSidebar} onSearch={() => setCommandOpen(true)} userMenu={userMenu} activity={isDesktop ? <FlowActivityBell sidebar expanded={effectiveSidebarExpanded} /> : null} />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" finalFocus={navigationTriggerRef} className="!z-[70] !w-[min(22rem,calc(100%-1rem))] gap-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="border-b pr-14">
            <SheetTitle>Filazoo workspace</SheetTitle>
            <SheetDescription>Accounts, conversations, and sales tools</SheetDescription>
          </SheetHeader>
          <Button variant="outline" className="mx-4 mt-4 justify-start" onClick={() => { setMobileOpen(false); setCommandOpen(true); }}><Search />Search workspace</Button>
          <nav aria-label="Workspace navigation" className="space-y-5 p-4">
            {navigation.map((group) => group.direct || group.nested ? <div key={group.label}>
              <Link href={group.items[0].href} onClick={() => setMobileOpen(false)} aria-current={itemIsActive(pathname, group.items[0]) ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${itemIsActive(pathname, group.items[0]) ? "bg-brand-soft font-semibold text-primary" : "hover:bg-muted"}`}><group.icon className={`${group.label === "Workflow" ? "size-5" : "size-4"} shrink-0`} />{group.label}</Link>
              {group.nested ? <ul className="ml-7 mt-1 space-y-1">{group.items.slice(1).map(item => <li key={item.href}><Link href={item.href} onClick={() => setMobileOpen(false)} aria-current={itemIsActive(pathname, item) ? "page" : undefined} className={`flex min-h-10 items-center rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${itemIsActive(pathname, item) ? "bg-brand-soft font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`}>{item.label}</Link></li>)}</ul> : null}
            </div> : <div key={group.label}>
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
              <ul className="space-y-1">{group.items.map((item) => <li key={item.href}>
                <Link href={item.href} onClick={() => setMobileOpen(false)} aria-current={itemIsActive(pathname, item) ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${itemIsActive(pathname, item) ? "bg-brand-soft font-semibold text-primary" : "hover:bg-muted"}`}>
                  <item.icon className="size-4 shrink-0" />{item.label}
                </Link>
              </li>)}</ul>
            </div>)}
          </nav>
          <div className="mt-auto flex items-center justify-between gap-3 border-t p-4"><div className="flex items-center gap-2">{userMenu}<span className="text-sm">Your account</span></div>{!isDesktop ? <FlowActivityBell /> : null}</div>
        </SheetContent>
      </Sheet>

      <PageHeaderProvider key={isSettings ? "settings" : "workspace"}>
        <div hidden={pageAiOpen} inert={pageAiOpen || undefined} className={`workspace-page flex min-w-0 flex-col bg-background transition-transform duration-300 ease-out lg:ml-[var(--workspace-sidebar-width)] ${usesViewportCanvas || isSettings || aiOpen ? "h-dvh" : "min-h-dvh"} ${sidebarAiOpen ? "overflow-y-auto overscroll-y-contain max-lg:-translate-x-full lg:mr-[var(--workspace-ai-width)]" : "translate-x-0 lg:mr-0"}`}>
          {!isSettings ? <WorkspacePageHeader pathname={pathname} /> : null}
          <main id="workspace-content" tabIndex={-1} className={`${isEmails || isDocuments || isSettings ? "" : "crm-workspace-content"} min-h-0 w-full flex-1 outline-none ${usesViewportCanvas ? "overflow-hidden p-0" : isSettings ? "overflow-y-auto p-0 lg:overflow-hidden" : "px-5 pb-6 pt-2 sm:px-6"}`}><WorkspaceTableHeaders />{children}</main>
        </div>
      </PageHeaderProvider>

      {commandOpen ? (
        <WorkspaceCommandMenu navigation={navigation} open={commandOpen} onOpenChange={setCommandOpen} onNavigate={navigate} />
      ) : null}
      {!aiOpen && !isHome ? <AiLauncher onSelect={mode => { setAiLaunchRequest(current => ({ id: current.id + 1, mode })); setAiLoaded(true); setAiOpen(true); }} /> : null}
      {/* Keep the panel mounted after its first use so drafts and running work survive closing. */}
      {aiLoaded ? <Suspense fallback={aiOpen ? <AiContainer id={isHome ? "workspace-ai-content" : undefined} aria-label="Filazoo AI workspace" className={`fixed inset-y-0 right-0 flex flex-col bg-background ${isHome ? "left-0 z-40 lg:left-[var(--workspace-sidebar-width)]" : "z-[60] w-full border-l lg:w-[var(--workspace-ai-width)]"}`}><div className="flex items-center justify-between border-b p-4"><span role="status" className="text-sm text-muted-foreground">Loading…</span><Button variant="ghost" size="sm" onClick={() => changeAiOpen(false)}>{isHome ? "Back to overview" : "Close"}</Button></div></AiContainer> : null}><WorkspaceAiAssistant open={aiOpen} onOpenChange={changeAiOpen} launchRequest={aiLaunchRequest} presentation={isHome ? "page" : "sidebar"} /></Suspense> : null}
    </div>
  );
}
