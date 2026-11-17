"use client";

import Link from "next/link";
import { ChartNoAxesCombined, LayoutGrid, List } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FlowCollectionView = "list" | "boxes";

export function FlowViewToggle({ active, onViewChange }: { active: FlowCollectionView | "analytics"; onViewChange?: (view: FlowCollectionView) => void }) {
  return <nav aria-label="Workflow views" className="inline-flex shrink-0 rounded-lg border bg-muted/40 p-0.5">
    {([{ id: "list", label: "List", href: "/workflow", icon: List }, { id: "boxes", label: "Box", href: "/workflow?view=boxes", icon: LayoutGrid }, { id: "analytics", label: "Analytics", href: "/workflow/analytics", icon: ChartNoAxesCombined }] as const).map(({ id, label, href, icon: Icon }) => {
      const className = cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 rounded-md px-3 text-xs", active === id ? "bg-background shadow-sm ring-1 ring-border" : "text-muted-foreground");
      return onViewChange && id !== "analytics" ? <button key={id} type="button" aria-pressed={active === id} className={className} onClick={() => onViewChange(id)}><Icon aria-hidden className="size-4" />{label}</button> : <Link key={id} href={href} aria-current={active === id ? "page" : undefined} className={className}><Icon aria-hidden className="size-4" />{label}</Link>;
    })}
  </nav>;
}
