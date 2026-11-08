import { LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function PurchaseOrderRegisterLoading({ drafts = false }: { drafts?: boolean }) {
  return <LoadingRegion label={drafts ? "Loading drafts" : "Loading purchase orders"} className="space-y-4 pt-3">
    {!drafts ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="space-y-3 rounded-lg border p-4"><Skeleton className="h-4 w-28 max-w-full" /><Skeleton className="h-6 w-12" /></div>)}</div> : null}
    <Skeleton className="h-11 rounded-xl" />
    <Skeleton className="h-9 rounded-lg" />
    {Array.from({ length: 8 }, (_, index) => <div key={index} className="flex h-10 items-center gap-8 border-b px-3"><Skeleton className="size-4 shrink-0 rounded" />{Array.from({ length: drafts ? 6 : 8 }, (_, column) => <Skeleton key={column} className="h-3 min-w-12 flex-1" />)}</div>)}
  </LoadingRegion>;
}
