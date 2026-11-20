import type { ReactNode } from "react";
import type { CompanyTab } from "@/lib/company-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyBillingSkeleton } from "@/components/workspace-skeletons";

function Header({ actions = true }: { actions?: boolean }) {
  return <div className="flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0 space-y-2"><Skeleton className="h-6 w-52 max-w-full" /><Skeleton className="h-4 w-72 max-w-full" /></div>
    {actions ? <div className="flex flex-wrap gap-2"><Skeleton className="h-9 w-32 rounded-lg" /><Skeleton className="h-9 w-20 rounded-lg" /><Skeleton className="size-9 rounded-lg" /></div> : null}
  </div>;
}

function Metrics({ count = 4 }: { count?: number }) {
  return <div data-loading-part="metrics" className={`grid gap-3 sm:grid-cols-2 ${count === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
    {Array.from({ length: count }, (_, index) => <div key={index} className="min-w-0 rounded-xl bg-muted/25 p-5"><Skeleton className="h-3 w-28 max-w-full" /><Skeleton className="mt-4 h-7 w-20" /><Skeleton className="mt-3 h-3 w-36 max-w-full" /></div>)}
  </div>;
}

function Loading({ tab, label, children, className = "space-y-5" }: { tab: CompanyTab; label: string; children: ReactNode; className?: string }) {
  return <div role="status" aria-label={label} aria-busy="true" data-company-loading={tab} className={`min-w-0 ${className}`}>
    <span className="sr-only">{label}</span><div aria-hidden="true" className="contents">{children}</div>
  </div>;
}

/** The same placeholder is used during navigation, data streaming and code loading. */
export function CompanySectionSkeleton({ tab }: { tab: CompanyTab }) {
  if (tab === "analyse") return <Loading tab={tab} label="Loading purchase analysis">
    <Header /><Skeleton className="h-3 w-56 max-w-full" /><Metrics />
    <div data-loading-part="charts" className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      {[0, 1].map(index => <div key={index} className="min-w-0 space-y-5 rounded-xl border p-5"><Skeleton className="h-4 w-40 max-w-full" /><Skeleton className="h-60 w-full rounded-lg" /></div>)}
    </div>
    <Skeleton className="h-24 w-full rounded-xl" /><div className="space-y-4"><Skeleton className="h-4 w-44" /><Skeleton className="h-40 w-full rounded-xl" /></div>
  </Loading>;

  if (tab === "customer-portal") return <Loading tab={tab} label="Loading customer portal">
    <Header /><Metrics count={3} />
    <div data-loading-part="portal" className="grid items-start gap-5 xl:grid-cols-[270px_minmax(0,1fr)]">
      <div className="space-y-4 rounded-xl border p-4"><Skeleton className="h-4 w-36" />{[0, 1, 2].map(index => <div key={index} className="space-y-3 rounded-lg bg-muted/20 p-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-40 max-w-full" /><Skeleton className="h-4 w-20" /></div>)}</div>
      <div className="min-w-0 space-y-5"><Skeleton className="h-36 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>
    </div>
  </Loading>;

  if (tab === "history") return <Loading tab={tab} label="Loading activity history">
    <Header actions={false} /><Skeleton data-loading-part="note" className="h-36 w-full rounded-xl" />
    <div data-loading-part="timeline" className="space-y-6 pt-3"><Skeleton className="mb-4 h-3 w-24" />
      {[0, 1, 2, 3].map(index => <div key={index} className="flex gap-3"><div className="flex w-12 shrink-0 flex-col items-center gap-1"><Skeleton className="size-10 rounded-full" /><Skeleton className="h-3 w-9" /></div><div className="min-w-0 flex-1 space-y-2 rounded-xl border bg-card px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><Skeleton className="h-3 w-44 max-w-full" /><Skeleton className="h-4 w-24" /></div><Skeleton className="h-3 w-4/5" /><div className="flex justify-between"><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-14" /></div></div></div>)}
    </div>
  </Loading>;

  if (tab === "email") return <Loading tab={tab} label="Loading customer conversations" className="company-email-section flex min-h-0 flex-1 flex-col gap-5 rounded-xl bg-card p-4">
    <Header /><Skeleton className="h-9 w-full max-w-[520px] rounded-lg" /><div className="flex gap-2"><Skeleton className="h-7 w-12" /><Skeleton className="h-7 w-16" /></div>
    <div className="min-h-0 flex-1 space-y-7 overflow-hidden">{[0, 1, 2].map(index => <div key={index} className="space-y-3"><div className="flex items-center gap-3"><Skeleton className="size-8 rounded-full" /><Skeleton className="h-4 w-40" /></div><Skeleton className="h-4 w-56 max-w-full" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-5 w-24 rounded-full" /></div>)}</div><Skeleton className="ml-auto h-4 w-36" />
  </Loading>;

  return <CompanyBillingSkeleton />;
}
