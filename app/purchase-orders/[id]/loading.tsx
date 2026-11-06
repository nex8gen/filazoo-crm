import { LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function OrderDetailsLoading() {
  return <LoadingRegion label="Loading order details" className="mx-auto max-w-[1100px] space-y-6 pt-3"><Skeleton className="h-4 w-32" /><div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12"><div className="space-y-8"><div className="space-y-3"><Skeleton className="h-7 w-36" /><Skeleton className="h-3 w-48" /></div><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-24" /></div><div className="space-y-6">{[0, 1, 2, 3].map(index => <div key={index} className="space-y-3 border-b pb-6"><Skeleton className="h-4 w-28" /><Skeleton className="h-12" /></div>)}</div></div></LoadingRegion>;
}
