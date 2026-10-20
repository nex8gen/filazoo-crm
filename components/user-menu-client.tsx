"use client";

import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function UserMenuClient({ name, email, role, initials }: { name: string; email: string; role: string; initials: string }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Open account menu for ${name}`} render={<Button variant="ghost" className="h-9 gap-2 rounded-lg px-1.5 sm:pr-2.5" />}><Avatar className="size-7"><AvatarFallback className="bg-gradient-to-br from-brand-soft to-muted text-[11px] font-semibold text-primary">{initials}</AvatarFallback></Avatar><span className="hidden max-w-32 truncate text-xs font-medium sm:inline">{name}</span><ChevronDown className="hidden size-3.5 text-muted-foreground transition-transform duration-150 in-data-popup-open:rotate-180 sm:block" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72"><DropdownMenuGroup><DropdownMenuLabel className="p-2.5 normal-case tracking-normal"><span className="flex items-center gap-3"><Avatar className="size-10"><AvatarFallback className="bg-gradient-to-br from-brand-soft to-muted text-sm font-semibold text-primary">{initials}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-foreground">{name}</span><span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{email}</span></span><Badge variant="outline" className="capitalize">{role}</Badge></span></DropdownMenuLabel></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuItem onClick={() => router.push("/settings")}><UserRound className="text-muted-foreground" />Profile</DropdownMenuItem><DropdownMenuItem onClick={() => router.push("/settings")}><Settings className="text-muted-foreground" />Workspace settings</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={async () => { await fetch("/auth/signout", { method: "POST" }); router.push("/login"); router.refresh(); }}><LogOut />Sign out</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
  );
}
