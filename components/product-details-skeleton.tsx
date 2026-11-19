import { FieldSkeleton } from "@/components/workspace-skeletons";
import { LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import "./product-editor.css";

export function ProductDetailsSkeleton() {
  return <LoadingRegion label="Loading product details" className="product-detail product-editor">
    <div className="product-editor-heading"><Skeleton className="size-8 shrink-0" /><Skeleton className="h-7 w-56 max-w-full" /><Skeleton className="h-7 w-20 rounded-lg" /></div>
    <div className="product-editor-form">
      <div className="product-editor-card product-content-card flex flex-col rounded-xl border bg-card">
        <FieldSkeleton /><div className="space-y-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-10 w-full rounded-t-xl" /><Skeleton className="h-[220px] w-full rounded-b-xl" /></div>
        <div className="space-y-3"><Skeleton className="h-4 w-20" /><div className="product-media-grid"><Skeleton className="product-media-item product-media-cover" />{[0, 1, 2, 3].map(index => <Skeleton key={index} className="product-media-item" />)}</div></div>
      </div>
      <div className="product-editor-card flex flex-col rounded-xl border bg-card"><Skeleton className="h-5 w-36" /><div className="grid gap-3 sm:grid-cols-2"><FieldSkeleton /><FieldSkeleton /></div></div>
      <div className="product-editor-card flex flex-col rounded-xl border bg-card"><Skeleton className="h-5 w-32" /><Skeleton className="h-28 w-full" /></div>
      <div className="product-editor-footer"><Skeleton className="h-9 w-40" /><div className="flex gap-2"><Skeleton className="h-9 w-20" /><Skeleton className="h-9 w-28" /></div></div>
    </div>
  </LoadingRegion>;
}
