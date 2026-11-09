import { LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <LoadingRegion label="Loading marketing assets" className="space-y-6 pt-6"><Skeleton className="h-9 w-80 max-w-full" /><Skeleton className="h-5 w-[480px] max-w-full" /><div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map(value => <Skeleton key={value} className="h-32 rounded-xl" />)}</div><Skeleton className="h-12 w-full" /><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(value => <Skeleton key={value} className="h-80 rounded-xl" />)}</div></LoadingRegion>;
}
