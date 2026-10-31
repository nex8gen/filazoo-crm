import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() { return <div className="mx-auto max-w-5xl space-y-5" aria-label="Loading quotation"><Skeleton className="h-10 w-64" /><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>; }
