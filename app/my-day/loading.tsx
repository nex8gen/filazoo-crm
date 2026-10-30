import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="mx-auto max-w-5xl space-y-6" aria-label="Loading My Day"><Skeleton className="h-10 w-40" /><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map(key => <Skeleton key={key} className="h-24 rounded-2xl" />)}</div><Skeleton className="h-96 rounded-2xl" /></div>;
}
