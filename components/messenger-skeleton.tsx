import { LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderDetails } from "@/components/page-header";
import styles from "@/components/messenger-inbox.module.css";

export function MessengerSkeleton() {
  return <LoadingRegion label="Loading messenger" className={"h-full min-h-0 border-t bg-background " + styles.workspace}>
    <PageHeaderDetails><div className="flex gap-1">{[56, 88, 96, 88, 88].map((width, index) => <Skeleton key={index} className="h-8 shrink-0 rounded-lg" style={{ width }} />)}</div></PageHeaderDetails>
    <div className={styles.layout}>
      <div className={"flex min-h-0 flex-col border-r " + styles.inbox}>
        <div className="space-y-3 border-b p-3"><div className="flex h-7 items-center justify-between"><Skeleton className="h-4 w-16" /><Skeleton className="size-7" /></div><Skeleton className="h-9 w-full" /><div className="flex gap-1"><Skeleton className="h-8 w-14" /><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-20" /></div></div>
        <div className="min-h-0 flex-1 overflow-hidden">{Array.from({ length: 7 }, (_, index) => <div key={index} className="flex gap-3 border-b px-4 py-4"><Skeleton className="size-8 shrink-0 rounded-full" /><div className="min-w-0 flex-1 space-y-2"><div className="flex justify-between gap-4"><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-10" /></div><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-16" /></div></div>)}</div>
      </div>
      <div className={"min-h-0 flex-col " + styles.conversation}>
        <div className="flex h-16 shrink-0 items-center gap-3 border-b px-4"><Skeleton className="size-8 shrink-0 rounded-full" /><div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-40" /></div><Skeleton className="ml-auto h-8 w-24" /></div>
        <div className="min-h-0 flex-1 space-y-6 overflow-hidden p-6"><Skeleton className="mx-auto h-3 w-28" /><Skeleton className="h-16 w-2/5 rounded-xl" /><Skeleton className="ml-auto h-20 w-2/5 rounded-xl" /></div>
        <div className="shrink-0 border-t p-4"><Skeleton className="h-36 w-full rounded-lg border" /></div>
      </div>
    </div>
  </LoadingRegion>;
}
