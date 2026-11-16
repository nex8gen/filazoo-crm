"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createWorkspaceNavigation } from "@/lib/workspace-navigation";

const NavigationContext = createContext<ReturnType<typeof createWorkspaceNavigation> | null>(null);

export function WorkspaceNavigationProvider({ accountId, children }: { accountId?: string; children: ReactNode }) {
  const [navigation] = useState(() => createWorkspaceNavigation(accountId ?? "guest"));
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();

  useEffect(() => {
    if (!accountId) return;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Browser storage can be disabled. */ }
    const href = pathname + (search ? `?${search}` : "") + window.location.hash;
    const destination = navigation.visit(href, storage);
    if (destination) router.replace(destination);
  }, [accountId, navigation, pathname, search, router]);

  return <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>;
}

export function useSettingsReturnTo() {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("WorkspaceNavigationProvider is missing");
  return useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot);
}
