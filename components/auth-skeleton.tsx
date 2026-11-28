import { AuthShell } from "@/components/auth-shell";
import { LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldSkeleton } from "@/components/workspace-skeletons";

// Auth artwork must not become a dependency of workspace loading placeholders.
export function AuthSkeleton({ fields = 2, variant }: { fields?: number; variant?: "signin" | "signup" }) {
  return <AuthShell variant={variant}><LoadingRegion label="Loading account" className="space-y-6"><div className="space-y-2 text-center"><Skeleton className="mx-auto h-7 w-40" />{variant !== "signin" ? <Skeleton className="mx-auto h-5 w-64 max-w-full" /> : null}</div><div className="space-y-4">{Array.from({ length: fields }, (_, index) => <FieldSkeleton key={index} />)}<Skeleton className="h-10 w-full" /></div><Skeleton className="mx-auto h-4 w-48 max-w-full" /></LoadingRegion></AuthShell>;
}
