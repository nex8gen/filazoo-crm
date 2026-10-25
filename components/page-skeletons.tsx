import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingRegion({ children, className = "", label }: { children: ReactNode; className?: string; label: string }) {
  return <div role="status" aria-label={label} aria-busy="true" className={`min-w-0 ${className}`}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className="contents">{children}</div>
  </div>;
}

export function HeaderSkeleton({ actions = true }: { actions?: boolean }) {
  return <div className="mb-7 flex shrink-0 flex-wrap items-start justify-between gap-4 border-b pb-6">
    <div className="min-w-0 flex-[1_1_20rem] space-y-1">
      <Skeleton className="h-7 w-36 max-w-full" />
      <Skeleton className="h-5 w-[32rem] max-w-full" />
    </div>
    {actions ? <div className="flex gap-2"><Skeleton className="h-9 w-24" /><Skeleton className="h-9 w-28" /></div> : null}
  </div>;
}

function SummarySkeleton({ flow = false }: { flow?: boolean }) {
  return <div className={`rounded-xl border bg-card shadow-sm ${flow ? "p-4" : "border-border/70 p-3.5 md:p-4"}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-24 max-w-full" />
        <Skeleton className={`${flow ? "mt-2" : "mt-1"} h-8 w-16 max-w-full`} />
        <Skeleton className={`mt-1 h-4 w-32 max-w-full ${flow ? "" : "hidden md:block"}`} />
      </div>
      <Skeleton className={`size-9 shrink-0 rounded-xl ${flow ? "" : "hidden md:block"}`} />
    </div>
  </div>;
}

export function TableSkeleton({ className = "", flow = false }: { className?: string; flow?: boolean }) {
  return <div className={className}>
    {flow ? null : <div className="mb-6 flex flex-wrap items-end gap-3"><div className="flex-1 space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-10 w-full" /></div><div className="space-y-2"><Skeleton className="h-4 w-16" /><Skeleton className="h-10 w-32" /></div><Skeleton className="h-10 w-24" /></div>}
    <div className="crm-table-frame"><div className="flex h-13 items-center gap-6 border-b bg-muted/40 px-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-3 flex-1" />)}</div><div className="divide-y">{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex items-center gap-6 p-4"><Skeleton className="h-7 w-1/3" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-7 w-20 rounded-full" /><Skeleton className="h-4 flex-1" /></div>)}</div></div>
    <div className="crm-table-pagination"><Skeleton className="h-4 w-32" /><div className="flex gap-2"><Skeleton className="h-10 w-20" /><Skeleton className="h-10 w-16" /></div></div>
  </div>;
}

export function CompaniesSkeleton() {
  return <LoadingRegion label="Loading companies" className="flex min-w-0 flex-col pb-8">
    <HeaderSkeleton />
    <div className="flex min-w-0 flex-col gap-6">
      <div className="crm-company-summary grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <SummarySkeleton key={index} />)}
      </div>
      <TableSkeleton  />
    </div>
  </LoadingRegion>;
}

export function FlowsSkeleton() {
  return <LoadingRegion label="Loading automation flows" className="scroll-surface h-full min-h-0 overflow-y-auto bg-muted/20">
    <div className="w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3"><Skeleton className="size-10 shrink-0 rounded-xl" /><div className="min-w-0"><Skeleton className="h-7 w-24" /><Skeleton className="mt-1 h-5 w-96 max-w-full" /></div></div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => <SummarySkeleton key={index} flow />)}
      </div>
      <TableSkeleton flow className="mt-5 shadow-none" />
    </div>
  </LoadingRegion>;
}

export function SegmentsSkeleton() {
  return <LoadingRegion label="Loading segments">
    <HeaderSkeleton actions={false} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex items-center gap-3 rounded-lg border bg-card p-5"><Skeleton className="size-4 shrink-0" /><div className="flex-1"><Skeleton className="h-5 w-32 max-w-full" /><Skeleton className="mt-1 h-4 w-20" /></div><Skeleton className="size-4" /></div>)}
    </div>
  </LoadingRegion>;
}

function FlowNodeSkeleton() {
  return <div className="w-full shrink-0 space-y-4 rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center gap-3"><Skeleton className="size-9 shrink-0 rounded-xl" /><Skeleton className="h-5 w-32 max-w-full" /></div><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>;
}

export function FlowEditorSkeleton() {
  return <LoadingRegion label="Loading flow editor" className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20">
    <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b bg-background px-4 py-2">
      <Skeleton className="h-4 w-12" /><Skeleton className="h-8 w-56 max-w-full" /><Skeleton className="h-5 w-16 rounded-full" />
      <div className="ml-auto flex gap-2"><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-24" /></div>
    </div>
    <div className="flex shrink-0 gap-2 border-b bg-background px-4 py-2 md:hidden"><Skeleton className="h-8 flex-1" /><Skeleton className="h-8 flex-1" /></div>
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-rows-[minmax(0,1fr)_minmax(0,42%)] lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_360px] min-[100rem]:grid-cols-[16rem_minmax(0,1fr)_360px]">
      <div className="hidden space-y-5 overflow-hidden border-r bg-background p-4 min-[100rem]:block"><div><Skeleton className="h-5 w-20" /><Skeleton className="mt-1 h-4 w-full" /></div><Skeleton className="h-10 w-full" />{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}</div>
      <div className="relative min-h-0 overflow-hidden">
        <div className="mx-auto flex h-full max-w-[344px] flex-col items-center overflow-hidden px-4 pt-10">
          <FlowNodeSkeleton /><div className="h-14 w-px shrink-0 bg-border" />
          <FlowNodeSkeleton /><div className="h-14 w-px shrink-0 bg-border" />
          <FlowNodeSkeleton />
        </div>
        <Skeleton className="absolute bottom-5 right-5 h-10 w-44 rounded-xl border" />
      </div>
      <div className="hidden min-h-0 overflow-hidden border-t bg-background md:block lg:border-l lg:border-t-0">
        <div className="flex h-12 items-center gap-4 border-b px-4"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-20" /></div>
        <div className="space-y-5 p-4 sm:p-5"><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
      </div>
    </div>
  </LoadingRegion>;
}

export function CompanyDetailsSkeleton() {
  return <LoadingRegion label="Loading company details">
    <Skeleton className="mb-4 h-8 w-36" />
    <div className="mb-6 flex min-w-0 flex-col gap-3 border-b pb-1 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div className="order-2 flex min-w-0 gap-2 overflow-hidden sm:order-1"><Skeleton className="h-10 w-14 shrink-0" /><Skeleton className="h-10 w-20 shrink-0" /><Skeleton className="h-10 w-20 shrink-0" /><Skeleton className="h-10 w-28 shrink-0" /></div>
      <div className="order-1 flex items-center gap-3 pb-2 sm:order-2 sm:shrink-0 sm:pb-0"><Skeleton className="size-8 shrink-0 rounded-full" /><Skeleton className="h-5 w-20" /><Skeleton className="h-8 w-28" /></div>
    </div>
    <div className="flex h-[min(48rem,calc(100dvh-5rem))] min-h-[32rem] flex-col rounded-lg border bg-card p-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-4"><Skeleton className="size-14 rounded-2xl" /><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64 max-w-full" /><div className="grid w-full max-w-lg gap-2 sm:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 rounded-xl" />)}</div></div>
      <Skeleton className="mt-6 h-36 w-full shrink-0 rounded-[20px]" />
    </div>
  </LoadingRegion>;
}
