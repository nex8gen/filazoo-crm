import { LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import "@/components/email-workspace.css";

function ConversationSkeleton() {
  return <>
    <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 sm:px-5"><div className="flex min-w-0 items-center gap-3"><Skeleton className="size-9 shrink-0 rounded-full" /><div><Skeleton className="h-4 w-32" /><Skeleton className="mt-1.5 h-3 w-24" /></div></div><Skeleton className="h-8 w-24" /></div>
    <div className="min-h-0 flex-1 space-y-6 overflow-hidden p-5"><Skeleton className="mx-auto h-4 w-24" /><Skeleton className="h-20 w-3/5 rounded-2xl" /><Skeleton className="ml-auto h-24 w-3/5 rounded-2xl" /><Skeleton className="h-16 w-2/5 rounded-2xl" /></div>
    <div className="shrink-0 border-t bg-background p-4"><Skeleton className="h-28 w-full rounded-xl border" /></div>
  </>;
}

export function EmailSkeleton({ reading = false }: { reading?: boolean }) {
  return <LoadingRegion label="Loading email" className="email-workspace flex h-[calc(100dvh-3rem)] min-w-0 flex-col overflow-hidden bg-background">
    <div className="mail-layout" data-reading={reading} data-details={false}>
      <div className="mail-folders min-h-0 flex-col border-r bg-muted/20">
        <div className="p-3"><Skeleton className="h-10 w-full" /></div>
        <div className="space-y-1 px-2 py-1">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex h-10 items-center gap-3 px-3"><Skeleton className="size-4" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-3 w-5" /></div>)}</div>
        <div className="mx-4 my-4 h-px bg-border" /><div className="px-5"><Skeleton className="h-4 w-24" /><Skeleton className="mt-3 h-36 w-full rounded-lg border" /></div>
      </div>
      <div className="mail-list overflow-hidden">
        <div className="border-b p-3">
          <div className="mail-folder-select mb-3"><Skeleton className="h-9 w-full" /></div>
          <div className="mb-2 flex h-8 items-center justify-between px-1"><Skeleton className="h-5 w-20" /><Skeleton className="size-6" /></div>
          <Skeleton className="h-9 w-full max-w-[520px] rounded-lg border" />
          <div className="mt-2 flex gap-1 overflow-hidden pb-0.5">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-6 w-20 shrink-0 rounded-full" />)}</div>
        </div>
        <div className="flex min-h-11 shrink-0 items-center gap-3 border-b px-3"><Skeleton className="size-4" /><Skeleton className="size-6" /><Skeleton className="h-3 w-28" /></div>
        <div className="mail-header-compose border-b px-3 py-2"><Skeleton className="h-8 w-24" /></div>
        <div className={`min-h-0 flex-1 overflow-hidden ${reading ? "mail-rows-compact" : ""}`}>
          <div className="mail-date-group"><Skeleton className="h-4 w-20" /></div>
          {Array.from({ length: 12 }, (_, index) => <div key={index} className="mail-row"><Skeleton className="size-4 shrink-0" /><div className="mail-row-open"><Skeleton className="size-1.5 rounded-full" /><Skeleton className="mail-sender h-4 w-4/5" /><div className="mail-summary"><Skeleton className="h-4 w-4/5" /></div><Skeleton className="h-3 w-8" /></div></div>)}
        </div>
        <div className="flex min-h-12 shrink-0 items-center justify-end gap-3 border-t px-3"><Skeleton className="h-4 w-40" /></div>
      </div>
      {reading ? <div className="mail-reader min-w-0"><div className="flex h-12 shrink-0 items-center justify-between border-b px-3"><Skeleton className="h-7 w-24" /><Skeleton className="h-7 w-20" /></div><div className="min-h-0 flex-1 space-y-6 overflow-hidden px-5 py-5"><div className="mx-auto max-w-3xl space-y-6"><Skeleton className="h-7 w-3/4" />{Array.from({ length: 3 }, (_, index) => <div key={index} className="space-y-4 border-b pb-6"><div className="flex justify-between gap-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" /></div>)}</div></div><div className="shrink-0 border-t p-5"><Skeleton className="mx-auto h-32 w-full max-w-3xl rounded-xl border" /></div></div> : null}
    </div>
  </LoadingRegion>;
}

export function MessengerSkeleton() {
  return <LoadingRegion label="Loading messenger" className="messenger-workspace flex h-[calc(100dvh-3rem)] flex-col overflow-hidden bg-[#f7f8fa] dark:bg-background">
    <div className="shrink-0 border-b bg-background px-4 pb-3 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><Skeleton className="h-10 w-44" /><div className="flex gap-2"><Skeleton className="hidden h-9 w-44 sm:block" /><Skeleton className="h-9 w-32" /></div></div>
      <div className="mt-3 flex gap-1 overflow-hidden">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-9 w-28 shrink-0" />)}</div>
    </div>
    <div className="relative grid min-h-0 flex-1 grid-cols-1 bg-background md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex min-h-0 min-w-0 flex-col border-r">
        <div className="border-b p-3"><div className="flex h-11 items-start justify-between px-1 pb-3"><Skeleton className="h-6 w-24" /><Skeleton className="h-7 w-16" /></div><Skeleton className="h-9 w-full border" /></div>
        <div className="min-h-0 flex-1 overflow-hidden p-2">{Array.from({ length: 8 }, (_, index) => <div key={index} className="mb-1.5 flex gap-3.5 rounded-xl p-3.5"><Skeleton className="size-10 shrink-0 rounded-full" /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-8" /></div><Skeleton className="mt-0.5 h-4 w-3/4" /><Skeleton className="mt-2 h-4 w-full" /></div></div>)}</div>
        <div className="flex shrink-0 justify-between gap-4 border-t px-4 py-2.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-20" /></div>
      </div>
      <div className="hidden min-h-0 min-w-0 flex-col bg-[#fbfbfc] md:flex dark:bg-background"><ConversationSkeleton /></div>
    </div>
  </LoadingRegion>;
}
