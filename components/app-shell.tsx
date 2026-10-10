"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  Inbox,
  LayoutDashboard,
  Library,
  LogOut,
  Mail,
  Search,
  Settings,
  UserRound,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const navigation = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Companies", href: "/companies", icon: Building2 },
  { label: "Pipeline", href: "/pipeline", icon: ChartNoAxesColumnIncreasing },
  { label: "Emails", href: "/emails", icon: Mail },
  { label: "Replies", href: "/replies", icon: Inbox },
  { label: "Catalogs", href: "/catalogs", icon: Library },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [commandOpen, setCommandOpen] = useState(false);

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

  if (pathname === "/login") return children;

  const navigate = (href: string) => {
    setCommandOpen(false);
    router.push(href);
  };

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon" variant="sidebar" className="border-r">
        <SidebarHeader className="h-14 justify-center border-b px-3">
          <Link href="/" className="flex items-center gap-2 overflow-hidden px-1">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">F</span>
            <span className="truncate text-sm font-medium tracking-tight group-data-[collapsible=icon]:hidden">Filazoo</span>
          </Link>
        </SidebarHeader>
        <SidebarContent className="px-2 py-4">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu>
                {navigation.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={active}
                        tooltip={item.label}
                        className="h-9 gap-3 data-active:bg-sidebar-accent data-active:text-primary data-active:[&_svg]:text-primary"
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t p-3">
          <div className="flex items-center gap-2 overflow-hidden rounded-lg px-1 py-2">
            <span className="size-2 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-xs font-medium">System operational</p>
              <p className="truncate text-xs text-muted-foreground">Demo workspace</p>
            </div>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <SidebarTrigger />
          <Button
            variant="outline"
            className="h-8 min-w-0 flex-1 justify-start gap-2 text-muted-foreground shadow-none sm:max-w-80"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="size-4" />
            <span className="truncate">Search workspace</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-normal sm:inline-flex">Ctrl K</kbd>
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 gap-2 px-2" />}>
                <Avatar className="size-7">
                  <AvatarFallback className="bg-brand-soft text-xs text-primary">RF</AvatarFallback>
                </Avatar>
                <span className="hidden text-xs font-medium sm:inline">Raul</span>
                <ChevronDown className="hidden size-3 text-muted-foreground sm:block" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Filazoo workspace</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem><UserRound /> Profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/settings")}><Settings /> Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem><LogOut /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto w-full max-w-screen-2xl p-4 md:p-6 lg:p-8">{children}</main>
      </SidebarInset>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Search pages…" />
        <CommandList>
          <CommandEmpty>No page found.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {navigation.map((item, index) => (
              <CommandItem key={item.href} value={item.label} onSelect={() => navigate(item.href)}>
                <item.icon />
                <span>{item.label}</span>
                {index < 7 && <CommandShortcut>{index + 1}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </SidebarProvider>
  );
}
