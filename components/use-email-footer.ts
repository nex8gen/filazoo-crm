"use client";

import { useEffect, useState } from "react";
import type { EmailFooter } from "@/lib/email-footer";

export function useEmailFooter() {
  const [footer, setFooter] = useState<EmailFooter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let updatedSinceLoad = false;
    async function load() {
      try {
        const response = await fetch("/api/email/footer", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load your email footer.");
        if (!controller.signal.aborted && !updatedSinceLoad) { setFooter(result.footer); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load your email footer.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    const updated = (event: Event) => { updatedSinceLoad = true; setFooter((event as CustomEvent<EmailFooter>).detail); setError(""); };
    void load();
    window.addEventListener("email-footer-updated", updated);
    return () => { controller.abort(); window.removeEventListener("email-footer-updated", updated); };
  }, []);
  return { footer, loading, error };
}
