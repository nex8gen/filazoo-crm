"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Building2, ChevronRight, CreditCard, LogOut, Settings, UserRound } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import type { AvatarPreset } from "@/lib/profile-avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import styles from "./user-menu.module.css";

export function UserMenuClient({ userId, name, email, role, imageUrl, preset, workspaceName, planName }: { userId: string; name: string; email: string; role: string; imageUrl?: string; preset?: AvatarPreset; workspaceName?: string; planName?: string }) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  function menuSideOffset() {
    const trigger = triggerRef.current;
    const sidebar = trigger?.closest("#workspace-sidebar");
    const page = sidebar?.closest("[data-workspace-shell]")?.querySelector(".workspace-page");
    return trigger && sidebar
      ? Math.max(sidebar.getBoundingClientRect().right, page?.getBoundingClientRect().left ?? 0) - trigger.getBoundingClientRect().right + 4
      : 4;
  }
  async function signOut() {
    await fetch("/auth/signout", { method: "POST" });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Logout clears all preserved account state with a document navigation.
    window.location.assign("/login");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger ref={triggerRef} aria-label={`Open account menu for ${name}`} render={<Button variant="ghost" className="size-12 rounded-xl p-2 data-popup-open:bg-muted" />}>
        <UserAvatar userId={userId} name={name} imageUrl={imageUrl} preset={preset} className="size-8" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={menuSideOffset} className={styles.content}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="sr-only">Account</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => router.push("/settings/profile")} className="gap-3 px-3 py-3">
            <UserAvatar userId={userId} name={name} imageUrl={imageUrl} preset={preset} className="size-7" />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className={`${styles.role} shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium capitalize`}>{role === "bd_manager" ? "BD manager" : role}</span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="mx-2 my-2" />
        <DropdownMenuItem className="min-h-10 px-3" onClick={() => router.push("/workspaces")}><Building2 /><span className="min-w-0"><span className="block truncate">{workspaceName || "Workspace"}</span><span className="block text-xs text-muted-foreground">Switch or create workspace</span></span></DropdownMenuItem>
        <DropdownMenuItem className="min-h-10 px-3" onClick={() => router.push("/settings/profile")}><UserRound />Profile</DropdownMenuItem>
        <DropdownMenuItem className="min-h-10 px-3" onClick={() => router.push("/settings")}><Settings />Settings</DropdownMenuItem>
        <DropdownMenuItem className={`${styles.subscription} min-h-10 px-3`} onClick={() => router.push("/subscribe")}>
          <CreditCard /><span>Subscription</span>
          {planName ? <span aria-label={`Current plan: ${planName}`} className={`${styles.plan} ml-auto max-w-32 truncate rounded-md px-2 py-0.5 text-xs font-medium`}>{planName}</span> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="mx-2 my-2" />
        <DropdownMenuItem className="min-h-10 px-3" onClick={signOut}><LogOut />Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
