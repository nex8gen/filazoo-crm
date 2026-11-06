import { LoadingRegion, TableSkeleton } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function PurchaseOrdersLoading() {
  return <LoadingRegion label="Loading purchase orders" className="space-y-5"><Skeleton className="h-7 w-80 max-w-full" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-32 rounded-xl" />)}</div><TableSkeleton /></LoadingRegion>;
}
