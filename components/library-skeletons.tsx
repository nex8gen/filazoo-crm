import { HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function DocumentsSkeleton() {
  return <LoadingRegion label="Loading files" className="document-library">
    <div className="library-layout">
      <div className="library-sidebar hidden space-y-6 border-r p-4 md:block"><Skeleton className="h-5 w-28" /><div className="space-y-3">{Array.from({ length: 9 }, (_, index) => <Skeleton key={index} className="h-7 w-full" />)}</div></div>
      <div className="library-main">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-5 md:px-6"><Skeleton className="h-6 w-40" /><Skeleton className="h-8 w-28" /></div>
        <div className="space-y-4 px-4 md:px-6"><div className="flex gap-2"><Skeleton className="h-9 min-w-0 flex-1" /><Skeleton className="h-9 w-28" /></div><Skeleton className="h-12 w-full rounded-xl" />
          <div className="divide-y rounded-xl border">{Array.from({ length: 7 }, (_, index) => <div key={index} className="flex items-center gap-4 p-4"><Skeleton className="size-9 shrink-0" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="hidden h-4 w-24 sm:block" /></div>)}</div>
        </div>
      </div>
    </div>
  </LoadingRegion>;
}

export function CampaignsSkeleton() {
  return <LoadingRegion label="Loading marketing campaigns" className="document-library campaign-workspace">
    <div className="campaign-planner">
      <div className="campaign-toolbar"><div className="campaign-types">{[0, 1, 2].map(index => <Skeleton key={index} className="h-8 w-28" />)}</div><Skeleton className="h-8 w-28" /></div>
      <div className="campaign-filters"><Skeleton className="h-9 w-full" /></div>
      <div className="campaign-campaigns"><div className="campaign-cardGrid">{Array.from({ length: 6 }, (_, index) => <div key={index} className="campaign-card"><Skeleton className="h-[164px] w-full rounded-none" /><div className="space-y-3 p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-6 w-3/4" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-1/2" /></div></div>)}</div></div>
    </div>
  </LoadingRegion>;
}

export function PortalLibrarySkeleton() {
  return <LoadingRegion label="Loading customer portal themes" className="portal-theme-library">
    <div className="flex items-center justify-between gap-3 rounded-xl border p-4"><div className="min-w-0 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-64 max-w-full" /></div><Skeleton className="h-8 w-28" /></div>
    <div className="ptl-live-card overflow-hidden rounded-xl border"><div className="ptl-live-heading"><Skeleton className="h-5 w-24" /><Skeleton className="h-5 w-12 rounded-full" /></div><div className="ptl-live-art"><Skeleton className="aspect-[1.65] w-full" /></div><div className="ptl-live-footer"><div className="w-full space-y-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-48" /></div><div className="flex gap-2"><Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-24" /></div></div></div>
    <div className="ptl-library"><Skeleton className="mb-3 h-6 w-36" /><div className="ptl-draft-row rounded-xl border"><Skeleton className="ptl-draft-thumb" /><Skeleton className="h-5 min-w-0 flex-1" /><Skeleton className="h-8 w-24" /></div></div>
    <div className="ptl-templates"><Skeleton className="mb-3 h-6 w-28" /><div className="ptl-template-grid">{[0, 1, 2].map(index => <Skeleton key={index} className="aspect-[1.5] w-full rounded-xl" />)}</div></div>
  </LoadingRegion>;
}

export function AiLeadsSkeleton() {
  return <LoadingRegion label="Loading AI Leads" className="min-w-0 space-y-6"><HeaderSkeleton />
    <div className="flex flex-wrap justify-between gap-3"><Skeleton className="h-9 w-72 max-w-full" /><Skeleton className="h-9 w-36" /></div>
    <div className="grid gap-4 border-b pb-5 sm:grid-cols-3">{[0, 1, 2].map(index => <div key={index} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-5 w-full" /></div>)}</div>
    <div className="flex flex-wrap gap-3">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-10 min-w-28 flex-1" />)}</div>
    <div className="divide-y rounded-xl border">{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex items-center gap-4 px-4 py-4"><Skeleton className="size-8 shrink-0 rounded-full" /><Skeleton className="h-4 min-w-0 flex-1" /><Skeleton className="h-4 min-w-0 flex-1" /><Skeleton className="hidden h-5 w-24 sm:block" /></div>)}</div>
  </LoadingRegion>;
}
