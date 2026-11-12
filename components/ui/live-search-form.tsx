"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** Navigate read-only search forms after typing, preserving focus and hidden filters. */
export function LiveSearchForm({ action, searchValue, className, children }: { action: string; searchValue?: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, [action]);
  useEffect(() => {
    const input = form.current?.elements.namedItem("q");
    // Server responses must not replace text that the user is still typing.
    if (input instanceof HTMLInputElement && document.activeElement !== input) input.value = searchValue ?? "";
  }, [searchValue]);
  function navigate() {
    if (timer.current) clearTimeout(timer.current);
    if (!form.current || composing.current) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form.current)) if (typeof value === "string" && value.trim()) params.set(key, value.trim());
    const href = `${action}${params.size ? `?${params}` : ""}`;
    if (href !== window.location.pathname + window.location.search) router.replace(href, { scroll: false });
  }
  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    if (!composing.current) timer.current = setTimeout(navigate, 200);
  }
  return <form ref={form} action={action} method="get" className={className} onChange={schedule} onCompositionStart={() => { composing.current = true; if (timer.current) clearTimeout(timer.current); }} onCompositionEnd={() => { composing.current = false; schedule(); }} onSubmit={event => { event.preventDefault(); navigate(); }}>{children}</form>;
}
