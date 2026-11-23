"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RefreshUsage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="billing-button billing-button-quiet" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>
    <RefreshCw aria-hidden="true" className={pending ? "billing-refreshing" : undefined} />
    <span role="status">{pending ? "Refreshing usage…" : "Refresh usage"}</span>
  </button>;
}
