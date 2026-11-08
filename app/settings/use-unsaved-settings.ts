"use client";

import { useEffect } from "react";
import { useLanguage } from "@/components/language-provider";

const approvedNavigations = new WeakSet<Event>();

/** Protect explicit-save forms when following links or closing/reloading the tab. */
export function useUnsavedSettings(dirty: boolean) {
  const { t } = useLanguage();
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    function beforeNavigate(event: MouseEvent) {
      if (event.defaultPrevented || approvedNavigations.has(event) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin === current.origin && destination.pathname === current.pathname && destination.search === current.search) return;
      if (!window.confirm(t("You have unsaved settings. Leave this page and discard your changes?"))) {
        event.preventDefault(); event.stopPropagation();
      } else approvedNavigations.add(event);
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigate, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", beforeNavigate, true); };
  }, [dirty, t]);
}
