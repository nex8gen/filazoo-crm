"use client";

import { useMemo, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { ChevronRight, ListTree, Search, Workflow } from "lucide-react";
import { flowActionLocations, flowActionTrail } from "@/lib/flow-tree";
import { stepLabels, type FlowInput } from "@/lib/flows";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

export function FlowOutline({ steps, selection, onFocus }: { steps: FlowInput["steps"]; selection: string; onFocus: (id: string) => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const entries = useMemo(() => flowActionLocations(steps).map(({ action, path }) => ({
    action,
    trail: flowActionTrail(steps, path),
    customTitle: Boolean(action.config.name || (action.type === "create_task" && action.config.title)),
    title: String(action.config.name || (action.type === "create_task" ? action.config.title : "") || stepLabels[action.type]),
  })), [steps]);
  const normalized = query.trim().toLocaleLowerCase();
  const matches = entries.filter(({ action, trail, title }) => `${title} ${stepLabels[action.type]} ${t(stepLabels[action.type])} ${trail.join(" ")}`.toLocaleLowerCase().includes(normalized));
  const focus = (id: string) => { onFocus(id); setOpen(false); };
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (!value) setQuery(""); }}>
    <PopoverTrigger className="flex h-9 items-center gap-2 rounded-xl border bg-background/95 px-3 text-xs font-semibold shadow-sm backdrop-blur hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ListTree className="size-4 text-muted-foreground" />Flow outline<span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{entries.length}</span></PopoverTrigger>
    <PopoverContent data-no-drag align="start" className="w-[340px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-2xl p-0 shadow-xl">
      <div className="border-b p-4"><PopoverTitle className="text-sm font-semibold">Flow outline</PopoverTitle><p className="mt-1 text-xs text-muted-foreground">Jump to any action at a readable zoom.</p><div className="relative mt-3"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find an action in this flow" placeholder="Find an action" className="h-9 pl-9" /></div></div>
      <nav aria-label="Flow outline" className="max-h-[min(420px,55dvh)] overflow-y-auto p-2">
        {!normalized ? <button type="button" onClick={() => focus("trigger")} aria-current={selection === "trigger" ? "step" : undefined} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-muted aria-current:bg-primary/8"><Workflow className="size-4 text-muted-foreground" /><span className="flex-1 font-medium">Trigger</span><ChevronRight className="size-3.5 text-muted-foreground" /></button> : null}
        {matches.map(({ action, trail, title, customTitle }) => <button key={action.id} type="button" aria-current={selection === action.id ? "step" : undefined} onClick={() => focus(action.id!)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted aria-current:bg-primary/8">
          <span className={`mt-1 h-3 w-1 shrink-0 rounded-full ${action.type === "split" ? "bg-indigo-400" : "bg-border"}`} />
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium" translate={customTitle ? "no" : undefined}>{title}</span><span className="mt-0.5 block break-words text-[11px] leading-4 text-muted-foreground" translate={trail.length ? "no" : undefined}>{trail.length ? trail.join(" / ") : stepLabels[action.type]}</span></span><ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        </button>)}
        {!matches.length && normalized ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching actions.</p> : null}
      </nav>
    </PopoverContent>
  </Popover>;
}
