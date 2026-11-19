import { FlowEditorSkeleton } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingEmailFlows() {
  return <div className="flex h-full min-h-0 flex-col"><div aria-hidden="true" className="flex flex-wrap items-center gap-3 border-b px-4 py-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-5 w-48" /><Skeleton className="ml-auto h-5 w-40" /></div><div className="min-h-0 flex-1"><FlowEditorSkeleton /></div></div>;
}
