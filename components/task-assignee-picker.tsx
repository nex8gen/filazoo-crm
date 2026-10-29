"use client";

import { useState } from "react";
import { Check, ChevronDown, LoaderCircle, UserRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { TaskAssignee } from "@/lib/task-activity";

const roles: Record<string, string> = { admin: "Admin", operator: "Operator", bd_manager: "Sales manager" };

export function TaskAssigneePicker({ members, value, viewerId, loading, disabled, onChange }: { members: TaskAssignee[]; value: string; viewerId: string; loading: boolean; disabled?: boolean; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = members.find(member => member.id === value);
  const name = selected?.name ?? (value === viewerId ? "Me" : "Assigned workspace user");
  const ordered = [...members].sort((a, b) => a.id === viewerId ? -1 : b.id === viewerId ? 1 : a.name.localeCompare(b.name));
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger disabled={disabled || loading} aria-label="Assignee" className="flex h-11 w-full items-center gap-2.5 rounded-lg border bg-background px-3 text-left text-sm font-normal outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/8 text-[10px] font-semibold text-primary">{loading ? <LoaderCircle className="size-3.5 animate-spin" /> : selected ? selected.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() : <UserRound className="size-3.5" />}</span><span className="min-w-0 flex-1 truncate" data-no-translate>{loading ? "Loading workspace users…" : name}</span>{value === viewerId && selected ? <span className="text-[10px] text-muted-foreground">You</span> : null}<ChevronDown className="size-3.5 text-muted-foreground" />
  </PopoverTrigger><PopoverContent align="start" aria-label="Choose task assignee" className="z-[80] w-[var(--anchor-width)] min-w-[260px] max-w-[calc(100vw-3rem)] gap-0 rounded-xl p-0 shadow-xl">
    <Command><CommandInput autoFocus aria-label="Search workspace users" placeholder="Search workspace users…" /><CommandList className="max-h-56"><CommandEmpty>No active workspace users found.</CommandEmpty><CommandGroup heading="Workspace users">{ordered.map(member => <CommandItem key={member.id} value={`${member.id} ${member.name} ${roles[member.role] ?? member.role}`} onSelect={() => { onChange(member.id); setOpen(false); }} className="gap-2.5 py-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/8 text-[10px] font-semibold text-primary" aria-hidden="true">{member.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium" data-no-translate>{member.name}</span><span className="text-[10px] text-muted-foreground">{roles[member.role] ?? "Workspace member"}</span></span>{member.id === viewerId ? <span className="text-[10px] text-muted-foreground">You</span> : null}{member.id === value ? <Check className="size-3.5 text-primary" /> : null}
    </CommandItem>)}</CommandGroup></CommandList></Command>
  </PopoverContent></Popover>;
}
