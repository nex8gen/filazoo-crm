"use client";

import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function UserMenuClient({ name, email, role, initials }: { name: string; email: string; role: string; initials: string }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 gap-2 px-2" />}><Avatar className="size-7"><AvatarFallback className="bg-brand-soft text-xs text-primary">{initials}</AvatarFallback></Avatar><span className="hidden max-w-28 truncate text-xs font-medium sm:inline">{name}</span><ChevronDown className="hidden size-3 text-muted-foreground sm:block" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56"><DropdownMenuLabel><span className="block truncate">{email}</span><Badge variant="outline" className="mt-1 capitalize">{role}</Badge></DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onClick={() => router.push("/settings")}><UserRound />Profile</DropdownMenuItem><DropdownMenuItem onClick={() => router.push("/settings")}><Settings />Settings</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={async () => { await fetch("/auth/signout", { method: "POST" }); router.push("/login"); router.refresh(); }}><LogOut />Sign out</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
  );
}
