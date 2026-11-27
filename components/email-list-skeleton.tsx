import { Skeleton } from "@/components/ui/skeleton";

export function EmailListSkeleton() {
  return <div role="status" aria-label="Loading emails…" aria-busy="true" className="divide-y">
    <span className="sr-only">Loading emails…</span>
    {Array.from({ length: 8 }, (_, i) => <div key={i} aria-hidden="true" className="flex gap-3 px-4 py-5">
      <Skeleton className="size-4 shrink-0 rounded" /><div className="min-w-0 flex-1 space-y-3"><div className="flex justify-between gap-4"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-12" /></div><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/2" /></div>
    </div>)}
  </div>;
}
