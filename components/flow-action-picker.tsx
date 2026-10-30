"use client";

import { useState, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import type { FlowStepType } from "@/lib/flows";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

export type FlowActionChoice = { type: FlowStepType; label: string; description: string; group: string; icon: ReactNode; tone: string };

export function FlowActionPicker({ items, context, label, disabled, onAdd, open: controlledOpen, onOpenChange }: { items: FlowActionChoice[]; context: string; label: string; disabled: boolean; onAdd: (type: FlowStepType) => void; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { t } = useLanguage();
  const [localOpen, setLocalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const open = controlledOpen ?? localOpen;
  const changeOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); if (!value) setQuery(""); };
  const normalized = query.trim().toLocaleLowerCase();
  const matches = items.filter((item) => `${item.label} ${t(item.label)} ${item.description} ${t(item.description)}`.toLocaleLowerCase().includes(normalized));
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger disabled={disabled} aria-label={label} className="relative my-auto grid size-8 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hidden"><Plus className="size-4" /></PopoverTrigger>
    <PopoverContent data-no-drag align="center" className="w-[320px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-2xl p-0 shadow-xl">
      <div className="border-b p-4"><div className="flex items-center justify-between gap-3"><PopoverTitle className="text-sm font-semibold">Add action</PopoverTitle><span translate="no" className="max-w-40 truncate rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{context}</span></div><div className="relative mt-3"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search actions to insert" placeholder="Find an action" className="h-9 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div>
      <div className="max-h-[min(400px,50dvh)] overflow-y-auto p-2">
        {[...new Set(items.map((item) => item.group))].map((group) => {
          const actions = matches.filter((item) => item.group === group);
          return actions.length ? <section key={group} aria-label={group + " actions"} className="mb-2 last:mb-0"><h3 className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</h3>{actions.map((item) => <button key={item.type} type="button" onClick={() => { onAdd(item.type); changeOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className={`grid size-8 shrink-0 place-items-center rounded-lg ${item.tone}`}>{item.icon}</span><span className="min-w-0"><span className="block text-xs font-semibold">{item.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{item.description}</span></span></button>)}</section> : null;
        })}
        {!matches.length ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching actions.</p> : null}
      </div>
    </PopoverContent>
  </Popover>;
}
