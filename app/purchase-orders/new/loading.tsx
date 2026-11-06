import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/page-skeletons";

export default function CreateOrderLoading() {
  return <LoadingRegion label="Loading order editor" className="mx-auto max-w-[1100px] space-y-6 pt-3"><Skeleton className="h-4 w-32" /><div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12"><div className="space-y-9"><h2 className="text-2xl font-medium">Create order</h2><div className="space-y-4"><Skeleton className="h-4 w-20" /><Skeleton className="h-20 rounded-2xl" /></div><div className="space-y-4"><Skeleton className="h-4 w-20" /><Skeleton className="h-52 rounded-2xl" /></div></div><div className="space-y-6">{[0, 1, 2, 3].map(index => <div key={index} className="space-y-3 border-b pb-6"><Skeleton className="h-4 w-24" /><Skeleton className="h-9 rounded-lg" /></div>)}</div></div></LoadingRegion>;
}
