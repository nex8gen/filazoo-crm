import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type AssignedOwnerProps = {
  name: string;
  initials: string;
  assigned: boolean;
  label?: string;
  compact?: boolean;
  className?: string;
};

export function AssignedOwner({ name, initials, assigned, label, compact = false, className }: AssignedOwnerProps) {
  return (
    <div className={cn("inline-flex min-w-0 items-center gap-2", className)} title={assigned ? `Assigned to ${name}` : "No BD Sales Manager assigned"}>
      <Avatar className={cn("shrink-0 border", compact ? "size-6" : "size-8", assigned ? "border-primary/20 bg-brand-soft" : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10")}>
        <AvatarFallback className={cn("text-xs font-semibold", assigned ? "bg-brand-soft text-primary" : "bg-transparent text-amber-700 dark:text-amber-300")}>
          {assigned ? initials : <UserRound className={compact ? "size-3" : "size-3.5"} />}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        {label ? <span className="block text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</span> : null}
        <span className={cn("block truncate font-medium", compact ? "max-w-28 text-xs" : "max-w-44 text-xs", assigned ? "text-foreground" : "text-amber-700 dark:text-amber-300")}>{name}</span>
      </span>
    </div>
  );
}
