import { LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import "./portal-builder.css";

export function PageLoadingSkeleton({ fullScreen = false }: { fullScreen?: boolean }) {
  return <LoadingRegion label="Loading page" className={`w-full space-y-6 bg-background p-5 sm:p-6 ${fullScreen ? "h-dvh overflow-hidden" : ""}`}>
    <div className="flex items-center justify-between gap-4"><Skeleton className="h-6 w-40" /><Skeleton className="h-8 w-24" /></div>
    <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map(index => <div key={index} className="space-y-3 rounded-xl border p-4"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-20" /><Skeleton className="h-3 w-32 max-w-full" /></div>)}</div>
    <div className="flex gap-3"><Skeleton className="h-9 min-w-0 flex-1" /><Skeleton className="h-9 w-24" /></div>
    <div className="divide-y rounded-xl border">{Array.from({ length: 7 }, (_, index) => <div key={index} className="flex items-center gap-5 p-4"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 min-w-0 flex-1" /><Skeleton className="h-5 w-20" /></div>)}</div>
  </LoadingRegion>;
}

function WebsitePlaceholder() {
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <div className="flex h-20 shrink-0 items-center justify-between gap-6 border-b px-6"><Skeleton className="h-8 w-28" /><div className="hidden gap-6 sm:flex"><Skeleton className="h-4 w-12" /><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-14" /></div><Skeleton className="h-8 w-28" /></div>
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 bg-muted/20 px-6 py-12 sm:px-12"><Skeleton className="h-3 w-32" /><Skeleton className="h-10 w-4/5 max-w-lg" /><Skeleton className="h-10 w-3/5 max-w-sm" /><Skeleton className="mt-2 h-4 w-full max-w-md" /><Skeleton className="h-4 w-4/5 max-w-sm" /><Skeleton className="mt-3 h-10 w-32" /></div>
    <div className="grid shrink-0 gap-4 border-t p-6 sm:grid-cols-2"><Skeleton className="h-20 w-full" /><Skeleton className="hidden h-20 w-full sm:block" /></div>
  </div>;
}

export function WebsiteLoadingSkeleton() {
  return <LoadingRegion label="Loading website" className="h-dvh overflow-hidden bg-background"><WebsitePlaceholder /></LoadingRegion>;
}

export function PortalEditorSkeleton() {
  return <LoadingRegion label="Loading website editor" className="portal-builder !h-dvh">
    <div className="pb-topbar"><div className="pb-theme-title"><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-36 max-w-full" /><Skeleton className="hidden h-5 w-12 rounded-full sm:block" /></div><div className="pb-page-picker"><Skeleton className="h-8 w-full" /></div><div className="pb-save-actions"><div className="pb-toolbar-tools"><Skeleton className="size-8" /><Skeleton className="size-8" /></div><div className="pb-toolbar-commands"><Skeleton className="h-8 w-16" /><Skeleton className="h-8 w-20" /></div></div></div>
    <div className="pb-mobile-tabs"><Skeleton className="h-[30px] flex-1" /><Skeleton className="h-[30px] flex-1" /><Skeleton className="h-[30px] flex-1" /></div>
    <div className="pb-workbench" data-structure="auto" data-inspector="true" data-mobile-panel="preview">
      <aside className="pb-structure"><div className="pb-structure-heading"><Skeleton className="h-4 w-28" /><Skeleton className="size-6" /></div><div className="pb-structure-scroll">{[0, 1, 2].map(group => <div key={group} className="pb-section-group"><Skeleton className="mb-4 h-3 w-16" />{Array.from({ length: group === 1 ? 4 : 2 }, (_, index) => <div key={index} className="my-3 flex items-center gap-3 px-2"><Skeleton className="size-4 shrink-0" /><Skeleton className="h-4 w-full" /></div>)}</div>)}</div><div className="pb-workspace"><Skeleton className="size-7" /><Skeleton className="h-3 w-24" /></div></aside>
      <div className="pb-preview"><div className="pb-browser"><div className="pb-portal-frame"><WebsitePlaceholder /></div></div></div>
      <aside className="pb-editor"><div className="pb-inspector-heading"><div className="pb-inspector-title"><Skeleton className="size-10 shrink-0 rounded-xl" /><Skeleton className="h-5 w-40" /><Skeleton className="ml-auto size-7 shrink-0" /></div><div className="pb-inspector-mode"><Skeleton className="h-9 w-full" /></div></div><div className="pb-panel space-y-6"><div className="flex justify-between gap-4"><Skeleton className="h-4 w-28" /><Skeleton className="h-5 w-9 rounded-full" /></div>{[0, 1, 2].map(index => <div key={index} className="space-y-3"><Skeleton className="h-3 w-20" /><Skeleton className={`${index === 1 ? "h-24" : "h-9"} w-full`} /></div>)}</div><div className="pb-editor-footer"><Skeleton className="h-3 w-20" /><Skeleton className="h-6 w-20" /></div></aside>
    </div>
  </LoadingRegion>;
}
