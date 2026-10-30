"use client";

import type { PointerEventHandler, ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, Settings2, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Props = {
  label: string;
  summary: string;
  icon: ReactNode;
  tone: string;
  index: number;
  selected: boolean;
  disabled: boolean;
  last: boolean;
  split?: boolean;
  detail?: ReactNode;
  onSelect: () => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
};

/** A quiet card surface keeps the configured action legible at every branch width. */
export function FlowActionCard({ label, summary, icon, tone, index, selected, disabled, last, split, detail, onSelect, onMove, onRemove, onPointerDown }: Props) {
  return <div
    data-flow-card
    data-flow-split-header={split ? "" : undefined}
    role="button"
    tabIndex={0}
    aria-pressed={selected}
    aria-label={`${label}, step ${index + 1}. Drag to reorder.`}
    onPointerDown={onPointerDown}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); }
    }}
    className={`group relative w-full touch-none cursor-grab overflow-visible rounded-2xl border bg-background text-left shadow-sm transition-[border-color,box-shadow] hover:border-foreground/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary ring-[3px] ring-primary/12 shadow-md" : "border-border"}`}
  >
    <div className="flex items-center gap-3 px-4 pt-3.5">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tone}`}>{icon}</span>
      <p className="min-w-0 flex-1 break-words text-sm font-semibold leading-5">{label}</p>
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground" aria-label={`Step ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
      {!disabled ? <div data-no-drag onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Action options for ${label}`} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
          <DropdownMenuContent data-no-drag align="end" className="w-44">
            <DropdownMenuItem onClick={onSelect}><Settings2 className="size-4" />Edit action</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(-1)} disabled={index === 0}><ArrowUp className="size-4" />Move up</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(1)} disabled={last}><ArrowDown className="size-4" />Move down</DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove} variant="destructive"><Trash2 className="size-4" />Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div> : null}
    </div>
    <p className="break-words px-4 pb-3.5 pt-2 text-sm leading-5 text-muted-foreground">{summary}</p>
    {detail ? <div className="flex items-center gap-2 rounded-b-2xl border-t bg-muted/25 px-4 py-2 text-[11px] text-muted-foreground">{detail}</div> : null}
    <GripVertical aria-hidden="true" className="pointer-events-none absolute -left-5 top-5 size-4 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
  </div>;
}
