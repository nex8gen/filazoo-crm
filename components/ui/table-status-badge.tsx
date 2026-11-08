import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TableStatusBadge({ children, tone = "neutral", filled = false, className }: {
  children: ReactNode;
  tone?: "neutral" | "yellow" | "green" | "red" | "blue";
  filled?: boolean;
  className?: string;
}) {
  return <span className={cn(`crm-table-status crm-table-status-${tone}`, className)}><span aria-hidden className={cn("crm-table-status-icon", filled && "crm-table-status-filled")} />{children}</span>;
}
