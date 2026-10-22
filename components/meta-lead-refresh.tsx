"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function MetaLeadRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, 15000);
    return () => clearInterval(timer);
  }, [router]);
  return <Button variant="outline" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Refreshing…" : "Refresh leads"}</Button>;
}
