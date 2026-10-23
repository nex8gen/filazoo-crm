import { FieldSkeleton } from "@/components/workspace-skeletons";
import { HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsSkeleton({ section = "general" }: { section?: string }) {
  const form = section === "profile" || section === "mailboxes";
  const workspace = section === "team" || section === "advanced";
  return <LoadingRegion label="Loading settings" className="flex min-h-[calc(100dvh-3rem)] flex-col md:flex-row">
    <div className="shrink-0 border-b bg-muted/10 p-3 md:sticky md:top-12 md:h-[calc(100dvh-3rem)] md:w-64 md:overflow-hidden md:border-b-0 md:border-r xl:w-72">
      <div className="px-3 pb-4 pt-2"><Skeleton className="h-6 w-20" /></div><Skeleton className="mb-4 h-9 w-full rounded-full" />
      <div className="flex gap-5 overflow-hidden pb-2 md:block md:space-y-6">{[4, 2, 2].map((count, group) => <div key={group} className="min-w-32 shrink-0"><Skeleton className="mx-3 mb-2 h-4 w-20" /><div className="space-y-1">{Array.from({ length: count }, (_, index) => <div key={index} className="flex min-h-9 items-center gap-2.5 px-3 py-2"><Skeleton className="size-[18px] shrink-0" /><Skeleton className="h-5 w-32 max-w-full" /></div>)}</div></div>)}</div>
    </div>
    <div className="min-w-0 flex-1 p-5 sm:p-8 lg:p-10"><HeaderSkeleton actions={false} />
      <div className={`space-y-4 ${workspace ? "" : "max-w-2xl"}`}>
        <div className="space-y-5 rounded-xl border bg-card p-6"><div><Skeleton className="h-5 w-36 max-w-full" /><Skeleton className="mt-2 h-4 w-full" /></div>
          {form ? <>
            {section === "profile" ? <div className="flex items-center gap-4 border-y py-5"><Skeleton className="size-20 shrink-0 rounded-full" /><Skeleton className="h-9 w-32" /></div> : null}
            <div className={`grid gap-4 ${section === "mailboxes" ? "sm:grid-cols-2" : ""}`}>{Array.from({ length: section === "mailboxes" ? 8 : 2 }, (_, index) => <FieldSkeleton key={index} />)}</div><Skeleton className="h-9 w-32" />
          </> : section === "appearance" ? <div className="grid grid-cols-3 gap-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-24 w-full rounded-lg border" />)}</div> : workspace ? <><Skeleton className="h-24 w-full" /><div className="grid gap-4 sm:grid-cols-2"><FieldSkeleton /><FieldSkeleton /></div><Skeleton className="h-9 w-32" /></> : <><Skeleton className="h-5 w-32" /><Skeleton className="h-5 w-48 max-w-full" /><Skeleton className="h-6 w-20 rounded-full" /><div className="flex gap-3 border-t pt-5"><Skeleton className="h-9 w-28" /><Skeleton className="h-9 w-28" /></div></>}
        </div>
        {workspace ? <div className="space-y-4 rounded-xl border p-6"><Skeleton className="h-5 w-40" />{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div> : null}
      </div>
    </div>
  </LoadingRegion>;
}
