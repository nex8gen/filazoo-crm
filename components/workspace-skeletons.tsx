import type { ReactNode } from "react";
import { HeaderSkeleton, LoadingRegion, TableSkeleton } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthShell } from "@/components/auth-shell";

function PanelSkeleton({ className = "", children }: { className?: string; children?: ReactNode }) {
  return <div className={`min-w-0 rounded-xl border bg-card p-5 ${className}`}><Skeleton className="h-5 w-36 max-w-full" /><Skeleton className="mt-2 h-4 w-3/4" />{children ?? <div className="mt-6 space-y-4"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-9 w-28" /></div>}</div>;
}

export function FieldSkeleton() {
  return <div className="min-w-0 space-y-2"><Skeleton className="h-5 w-24 max-w-full" /><Skeleton className="h-10 w-full rounded-md border" /></div>;
}

function RowsSkeleton({ columns = 5, rows = 6, image = false }: { columns?: number; rows?: number; image?: boolean }) {
  return <div className="min-h-0 flex-1 overflow-hidden">
    <div className="flex h-12 items-center gap-6 border-b bg-muted/30 px-4">{Array.from({ length: columns }, (_, index) => <Skeleton key={index} className="h-3 min-w-0 flex-1" />)}</div>
    <div className="divide-y">{Array.from({ length: rows }, (_, index) => <div key={index} className="flex items-center gap-6 px-4 py-4">{Array.from({ length: columns }, (_, column) => column === 0 && image ? <div key={column} className="flex min-w-0 flex-1 items-center gap-3"><Skeleton className="size-10 shrink-0 rounded-lg" /><Skeleton className="h-4 min-w-0 flex-1" /></div> : <Skeleton key={column} className="h-4 min-w-0 flex-1" />)}</div>)}</div>
  </div>;
}

function PaginationSkeleton() {
  return <div className="crm-table-pagination"><Skeleton className="h-4 w-32" /><Skeleton className="h-8 w-36" /></div>;
}

export function DashboardSkeleton() {
  return <LoadingRegion label="Loading dashboard" className="mx-auto max-w-[1500px] space-y-6">
    <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><Skeleton className="mb-2 h-4 w-48 max-w-full" /><Skeleton className="h-8 w-52 max-w-full" /><Skeleton className="mt-1 h-5 w-96 max-w-full" /></div><div className="flex flex-wrap gap-2 xl:max-w-[850px]">{["w-60", "w-36", "w-24", "w-32"].map((width) => <Skeleton key={width} className={`h-9 max-w-full ${width}`} />)}</div></div></div>
    <Skeleton className="h-8 w-full rounded-lg" />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex justify-between gap-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-12" /></div><Skeleton className="mt-3 h-8 w-28" /><Skeleton className="mt-1 h-4 w-24" /></div>)}</div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">{["xl:col-span-12", "xl:col-span-4", "xl:col-span-8", "xl:col-span-4", "xl:col-span-5", "xl:col-span-7"].map((span, index) => <PanelSkeleton key={index} className={span}><div className="mt-6 flex h-64 items-end gap-3 border-b border-l px-4 pb-3 pt-6">{["h-1/3", "h-1/2", "h-2/5", "h-3/4", "h-3/5", "h-5/6", "h-2/3"].map((height, bar) => <Skeleton key={bar} className={`min-w-0 flex-1 rounded-t-md ${height}`} />)}</div></PanelSkeleton>)}</div>
  </LoadingRegion>;
}

export function ProductsSkeleton() {
  return <LoadingRegion label="Loading products" className="space-y-6"><Skeleton className="h-7 w-28" /><TableSkeleton /></LoadingRegion>;
}

export function CatalogsSkeleton() {
  return <LoadingRegion label="Loading company catalogs" className="space-y-6"><HeaderSkeleton /><TableSkeleton /></LoadingRegion>;
}

function InvoiceHeaderSkeleton() {
  return <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6"><div className="min-w-0"><Skeleton className="mb-2 h-4 w-16" /><Skeleton className="h-8 w-40" /><Skeleton className="mt-2 h-5 w-96 max-w-full" /></div><div className="flex gap-2"><Skeleton className="h-9 w-24" /><Skeleton className="h-9 w-28" /></div></div>;
}

export function InvoicesSkeleton() {
  return <LoadingRegion label="Loading invoices" className="invoice-workspace mx-auto w-full max-w-7xl space-y-6 p-5 pb-12 sm:p-8">
    <InvoiceHeaderSkeleton />
    <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="rounded-xl border p-5"><Skeleton className="h-5 w-28" /><Skeleton className="my-2 h-8 w-24" /><Skeleton className="h-4 w-full" /></div>)}</div>
    <div className="flex flex-wrap items-end gap-3"><div className="flex-[1_1_16rem]"><FieldSkeleton /></div><div className="w-40 max-w-full"><FieldSkeleton /></div><Skeleton className="h-10 w-24" /></div>
    <div className="crm-table-frame"><RowsSkeleton columns={7} /></div>
    <div className="flex items-center justify-between gap-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-9 w-40" /></div>
  </LoadingRegion>;
}

export function InvoiceEditorSkeleton() {
  return <LoadingRegion label="Loading invoice editor" className="invoice-workspace mx-auto w-full max-w-7xl space-y-6 p-5 pb-12 sm:p-8"><InvoiceHeaderSkeleton />
    <div className="space-y-7">
      <div className="grid gap-6 lg:grid-cols-2">{Array.from({ length: 2 }, (_, index) => <PanelSkeleton key={index}><div className="mt-4 space-y-4">{Array.from({ length: 4 }, (_, field) => <FieldSkeleton key={field} />)}</div></PanelSkeleton>)}</div>
      <div className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <FieldSkeleton key={index} />)}</div>
      <PanelSkeleton><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[3fr_1fr_1.5fr_1fr_auto]">{Array.from({ length: 4 }, (_, index) => <FieldSkeleton key={index} />)}<Skeleton className="h-10 w-10 self-end" /></div></PanelSkeleton>
      <div className="grid gap-6 lg:grid-cols-2"><PanelSkeleton /><PanelSkeleton /></div><div className="flex justify-end gap-3"><Skeleton className="h-10 w-24" /><Skeleton className="h-10 w-32" /></div>
    </div>
  </LoadingRegion>;
}

export function InvoiceDetailsSkeleton() {
  return <LoadingRegion label="Loading invoice details" className="invoice-workspace mx-auto w-full max-w-7xl space-y-6 p-5 pb-12 sm:p-8"><InvoiceHeaderSkeleton /><Skeleton className="h-12 w-full rounded-lg border" /><div className="flex flex-wrap items-center gap-2"><Skeleton className="h-6 w-16 rounded-full" /><Skeleton className="mr-auto h-5 w-32" /><Skeleton className="h-9 w-24" /><Skeleton className="h-9 w-36" /></div><div className="mx-auto w-full max-w-[210mm] space-y-8 rounded-lg border bg-card p-6 sm:p-10"><div className="flex justify-between gap-6"><Skeleton className="h-16 w-40" /><Skeleton className="h-20 w-40" /></div><div className="grid gap-6 sm:grid-cols-2"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div><RowsSkeleton columns={4} rows={4} /><Skeleton className="ml-auto h-24 w-56 max-w-full" /><Skeleton className="h-24 w-full" /></div></LoadingRegion>;
}

export function PipelineSkeleton() {
  return <LoadingRegion label="Loading pipeline"><HeaderSkeleton /><div className="mb-3 space-y-2 md:hidden"><Skeleton className="h-5 w-24" /><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-3/4" /></div><div className="overflow-hidden"><div className="flex gap-4">{Array.from({ length: 6 }, (_, index) => <div key={index} className={`${index ? "hidden md:block" : ""} w-full shrink-0 space-y-3 rounded-xl border bg-muted/30 p-3 md:w-72`}><div className="flex h-8 items-center justify-between"><Skeleton className="h-4 w-32" /><Skeleton className="size-5 rounded-full" /></div>{Array.from({ length: 3 }, (_, card) => <div key={card} className="space-y-3 rounded-xl border bg-card p-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-24" /><div className="flex justify-between border-t pt-3"><Skeleton className="h-4 w-24" /><Skeleton className="size-6 rounded-full" /></div></div>)}</div>)}</div></div></LoadingRegion>;
}

export function RepliesSkeleton() {
  return <LoadingRegion label="Loading replies"><HeaderSkeleton actions={false} /><div className="space-y-4">{Array.from({ length: 3 }, (_, index) => <PanelSkeleton key={index}><div className="mt-6 space-y-2"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-5/6" /><Skeleton className="h-5 w-2/3" /></div></PanelSkeleton>)}</div></LoadingRegion>;
}

export function DeliverabilitySkeleton() {
  return <LoadingRegion label="Loading deliverability" className="space-y-6"><HeaderSkeleton actions={false} /><div className="flex gap-2 border-b pb-4">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16 w-28 rounded-xl border" />)}</div><div className="crm-table-frame bg-card"><RowsSkeleton columns={3} rows={3} /></div><PaginationSkeleton /></LoadingRegion>;
}

export function MetaLeadsSkeleton() {
  return <LoadingRegion label="Loading Meta leads" className="space-y-6"><HeaderSkeleton /><Skeleton className="h-5 w-96 max-w-full" /><PanelSkeleton><div className="mt-6 space-y-4"><Skeleton className="h-5 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-12 w-full" /></div></PanelSkeleton><PanelSkeleton><div className="mt-6"><RowsSkeleton columns={6} rows={4} /></div></PanelSkeleton></LoadingRegion>;
}

export function SetupSkeleton() {
  return <LoadingRegion label="Loading setup"><HeaderSkeleton /><PanelSkeleton className="mb-6"><Skeleton className="mt-4 h-8 w-20" /><Skeleton className="mt-4 h-2 w-full" /></PanelSkeleton><div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]"><div className="space-y-4">{Array.from({ length: 4 }, (_, index) => <PanelSkeleton key={index}><div className="mt-5 grid gap-4 sm:grid-cols-2"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div></PanelSkeleton>)}</div><div className="space-y-4"><PanelSkeleton /><PanelSkeleton /><PanelSkeleton /></div></div></LoadingRegion>;
}

export function AuthSkeleton({ fields = 2 }: { fields?: number }) {
  return <AuthShell><LoadingRegion label="Loading account" className="space-y-6"><div className="space-y-2 text-center"><Skeleton className="mx-auto h-7 w-40" /><Skeleton className="mx-auto h-5 w-64 max-w-full" /></div><div className="space-y-4">{Array.from({ length: fields }, (_, index) => <FieldSkeleton key={index} />)}<Skeleton className="h-10 w-full" /></div><Skeleton className="mx-auto h-4 w-48 max-w-full" /></LoadingRegion></AuthShell>;
}

export function EmailQueueSkeleton() {
  return <LoadingRegion label="Loading email queue" ><div className="crm-table-frame bg-card"><RowsSkeleton columns={6} /></div><PaginationSkeleton /></LoadingRegion>;
}

export function CustomerInvoicesSkeleton() {
  return <LoadingRegion label="Loading customer invoices" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><Skeleton className="h-5 w-40" /><Skeleton className="mt-1 h-4 w-48 max-w-full" /></div><Skeleton className="h-9 w-36" /></div><div className="space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"><div className="min-w-0 space-y-2"><div className="flex gap-2"><Skeleton className="h-5 w-28" /><Skeleton className="h-5 w-16 rounded-full" /></div><Skeleton className="h-4 w-40" /></div><Skeleton className="h-8 w-32" /></div>)}</div></LoadingRegion>;
}

export function CompanyBillingSkeleton() {
  return <LoadingRegion label="Loading customer billing" className="mb-7 space-y-4 rounded-xl border p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><Skeleton className="h-6 w-56 max-w-full" /><Skeleton className="mt-1 h-5 w-64 max-w-full" /></div><div className="flex gap-3"><Skeleton className="h-9 w-32" /><Skeleton className="h-9 w-40" /></div></div><Skeleton className="h-20 w-64 max-w-full rounded-lg" /><div className="divide-y">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex justify-between gap-3 py-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-5 w-24" /><Skeleton className="h-5 w-20" /></div>)}</div></LoadingRegion>;
}
