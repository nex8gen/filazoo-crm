import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/page-skeletons";
import "./home-workspace.css";

export function HomeSkeleton() {
  return <LoadingRegion label="Loading Home" className="home-workspace w-full">
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
      <div className="home-overview">
        <div className="home-overview-date"><Skeleton className="h-7 w-44 max-w-full" /></div>
        <div className="home-overview-metrics">{[0, 1, 2, 3].map(index => <div key={index} className="home-overview-metric"><Skeleton className="h-4 w-20 max-w-full" /><Skeleton className="h-6 w-24 max-w-full" /></div>)}</div>
        <Skeleton className="size-6 justify-self-end" />
      </div>
      <div className="home-ai">
        <div className="home-ai-welcome"><Skeleton className="mx-auto mb-4 size-12 rounded-xl" /><Skeleton className="mx-auto h-9 w-72 max-w-full" /><Skeleton className="mx-auto mt-2.5 h-5 w-60 max-w-full" /></div>
        <Skeleton className="mx-auto h-32 w-full max-w-[640px] rounded-[20px]" />
        <div className="home-ai-suggestions">
          <div className="home-ai-prompt-grid">{[0, 1, 2, 3].map(index => <div key={index} className="home-ai-prompt-card"><Skeleton className="mb-7 size-10 rounded-lg" /><Skeleton className="h-4 w-full" /><Skeleton className="mt-2 h-8 w-full" /></div>)}</div>
          <div className="home-ai-prompt-chips">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9 w-36 rounded-full" />)}</div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1000px] space-y-4"><Skeleton className="h-5 w-44" /><div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-40 rounded-xl border" />)}</div></div>
    </div>
  </LoadingRegion>;
}
