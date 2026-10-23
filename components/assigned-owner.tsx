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
    <div className={cn("inline-flex min-w-0 items-center", compact ? "gap-2" : "gap-3", className)} title={assigned ? `Assigned to ${name}` : "No manager assigned"}>
      <Avatar className={cn("shrink-0", compact ? "size-6" : "size-10")}>
        <AvatarFallback className={cn("text-xs font-semibold", assigned ? "bg-brand-soft text-primary" : "bg-muted text-muted-foreground")}>
          {assigned ? initials : <UserRound className={compact ? "size-3" : "size-3.5"} />}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 space-y-0.5">
        {label ? <span className="block text-[11px] leading-4 text-muted-foreground">{label}</span> : null}
        <span className={cn("block truncate font-medium text-foreground", compact ? "max-w-28 text-xs" : "max-w-48 text-sm leading-5")}>{name}</span>
      </span>
    </div>
  );
}
