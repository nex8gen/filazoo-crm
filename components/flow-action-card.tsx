"use client";

import type { PointerEventHandler, ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, MoreVertical, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FlowStepType } from "@/lib/flows";
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
  kind?: FlowStepType;
  detail?: ReactNode;
  onSelect: () => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
};

/** A quiet card surface keeps the configured action legible at every branch width. */
export function FlowActionCard({ label, summary, icon, tone, index, selected, disabled, last, split, kind, detail, onSelect, onMove, onRemove, onPointerDown }: Props) {
  const actionKind = kind || (split ? "split" : "stop");
  const actionGroup = actionKind === "send_email" || actionKind === "ai_auto_reply" ? "message" : ["create_task", "change_category", "update_company", "internal_alert"].includes(actionKind) ? "data" : "logic";
  return <div
    data-flow-card
    data-flow-kind={actionKind}
    data-flow-group={actionGroup}
    data-flow-split-header={split ? "" : undefined}
    role="button"
    tabIndex={0}
    aria-pressed={selected}
    aria-label={`${label}, step ${index + 1}.${disabled ? "" : " Drag to reorder."}`}
    onPointerDown={onPointerDown}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); }
    }}
    className={`group relative w-full touch-none overflow-visible rounded-2xl border bg-background text-left shadow-sm transition-[border-color,box-shadow] hover:border-foreground/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${disabled ? "cursor-pointer" : "cursor-grab"} ${selected ? "border-primary ring-[3px] ring-primary/12 shadow-md" : "border-border"}`}
  >
    <div className="wf-node-heading">
      <div className="wf-node-kicker"><span className={tone}>{icon}</span><span>{label}</span></div>
      <p className="wf-node-summary" title={summary}>{summary}</p>
      {!disabled ? <div data-no-drag onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Action options for ${label}`} className="wf-node-menu grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreVertical className="size-4" /></DropdownMenuTrigger>
          <DropdownMenuContent data-no-drag align="end" className="w-44">
            <DropdownMenuItem onClick={onSelect}><Settings2 className="size-4" />Edit action</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(-1)} disabled={index === 0}><ArrowUp className="size-4" />Move up</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(1)} disabled={last}><ArrowDown className="size-4" />Move down</DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove} variant="destructive"><Trash2 className="size-4" />Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div> : null}
    </div>
    {!split && kind !== "stop" && kind !== "wait" ? <div data-no-drag className="wf-node-body" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}><Button type="button" variant="outline" className="wf-node-configure" onClick={onSelect}>Configure {label.toLowerCase()}</Button></div> : null}
    {detail ? <div className="flex items-center gap-2 rounded-b-2xl border-t bg-muted/25 px-4 py-2 text-[11px] text-muted-foreground">{detail}</div> : null}
    <GripVertical aria-hidden="true" className="pointer-events-none absolute -left-5 top-5 size-4 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
  </div>;
}
