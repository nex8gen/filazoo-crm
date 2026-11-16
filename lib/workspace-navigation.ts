import { safeInternalPath } from "./safe-redirect.ts";
import { isStandaloneRoute } from "./standalone-routes.ts";

type SessionStorage = Pick<Storage, "getItem" | "setItem">;

function pathname(href: string) { return href.split(/[?#]/, 1)[0]; }
function isSettings(path: string) { return path === "/settings" || path.startsWith("/settings/"); }

/** One account in one browser tab. Refreshes retain the Settings return page. */
export function createWorkspaceNavigation(accountId: string) {
  const key = `filazoo:workspace-navigation:v1:${accountId}`;
  const listeners = new Set<() => void>();
  let initialized = false;
  let lastPage = "/";

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => lastPage,
    getServerSnapshot: () => "/",
    visit(href: string, storage: SessionStorage | null): "/" | null {
      const path = pathname(href);
      if (isStandaloneRoute(path)) return null;
      const previous = lastPage;
      let redirectHome = false;
      if (!initialized) {
        initialized = true;
        let saved: { started?: boolean; lastPage?: unknown } | null = null;
        try { saved = JSON.parse(storage?.getItem(key) || "null"); } catch { /* Storage may be unavailable. */ }
        const restored = safeInternalPath(saved?.lastPage);
        if (!isStandaloneRoute(pathname(restored)) && !isSettings(pathname(restored))) lastPage = restored;
        redirectHome = saved?.started !== true && href !== "/";
      }
      // Never remember a stale restored tab as the page preceding Settings.
      const next = redirectHome ? "/" : isSettings(path) ? lastPage : href;
      lastPage = next;
      try { storage?.setItem(key, JSON.stringify({ started: true, lastPage })); } catch { /* Keep working in memory. */ }
      if (lastPage !== previous) listeners.forEach(listener => listener());
      return redirectHome ? "/" : null;
    },
  };
}
