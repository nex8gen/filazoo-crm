"use client";

import { useRouter } from "next/navigation";
import { ChevronRight, LogOut, Settings, UserRound } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import type { AvatarPreset } from "@/lib/profile-avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function UserMenuClient({ userId, name, email, role, imageUrl, preset }: { userId: string; name: string; email: string; role: string; imageUrl?: string; preset?: AvatarPreset }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/auth/signout", { method: "POST" });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Logout clears all preserved account state with a document navigation.
    window.location.assign("/login");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Open account menu for ${name}`} render={<Button variant="ghost" className="size-12 rounded-xl p-2 data-popup-open:bg-muted" />}>
        <UserAvatar userId={userId} name={name} imageUrl={imageUrl} preset={preset} className="size-8" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="sr-only">Account</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => router.push("/settings/profile")} className="gap-3 px-3 py-3">
            <UserAvatar userId={userId} name={name} imageUrl={imageUrl} preset={preset} className="size-7" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-xs capitalize text-muted-foreground">{role}</span><span className="block truncate text-xs text-muted-foreground">{email}</span></span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="mx-2 my-2" />
        <DropdownMenuItem className="min-h-10 px-3" onClick={() => router.push("/settings/profile")}><UserRound />Profile</DropdownMenuItem>
        <DropdownMenuItem className="min-h-10 px-3" onClick={() => router.push("/settings")}><Settings />Settings</DropdownMenuItem>
        <DropdownMenuSeparator className="mx-2 my-2" />
        <DropdownMenuItem className="min-h-10 px-3" onClick={signOut}><LogOut />Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
