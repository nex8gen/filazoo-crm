import type { LucideIcon } from "lucide-react";
import { CircleAlert, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  children,
  compact = false,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  action?: { label: string; onClick?: () => void };
  children?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card text-center shadow-none", compact ? "min-h-40 p-6" : "min-h-64 p-8", className)}>
      <div className="grid size-12 shrink-0 place-items-center rounded-xl border bg-muted/50"><Icon aria-hidden="true" className="size-6 text-muted-foreground" strokeWidth={1.5} /></div>
      <div className="space-y-1"><p className="text-sm font-medium text-foreground">{title}</p>{description ? <p className="mx-auto max-w-sm text-xs leading-5 text-muted-foreground">{description}</p> : null}</div>
      {action && <Button size="sm" onClick={action.onClick}>{action.label}</Button>}
      {children}
    </div>
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
