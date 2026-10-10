import type { LucideIcon } from "lucide-react";
import { CircleAlert, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  children,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: { label: string; onClick?: () => void };
  children?: React.ReactNode;
}) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="grid size-10 place-items-center rounded-lg border bg-muted"><Icon className="size-4 text-muted-foreground" /></div>
        <div className="space-y-1"><h2 className="text-sm font-medium">{title}</h2><p className="max-w-sm text-xs text-muted-foreground">{description}</p></div>
        {action && <Button size="sm" onClick={action.onClick}>{action.label}</Button>}
        {children}
      </CardContent>
    </Card>
  );
}

export function ErrorState({ retry }: { retry?: () => void }) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="grid size-10 place-items-center rounded-lg border bg-muted"><CircleAlert className="size-4 text-muted-foreground" /></div>
        <div className="space-y-1"><h2 className="text-sm font-medium">Something went wrong</h2><p className="text-xs text-muted-foreground">We could not load this view. Try again in a moment.</p></div>
        {retry && <Button size="sm" variant="outline" onClick={retry}>Try again</Button>}
      </CardContent>
    </Card>
  );
}

export function DataSkeleton() {
  return <div className="space-y-4"><Skeleton className="h-20 w-full" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32" />)}</div><Skeleton className="h-80 w-full" /></div>;
}
