"use client";

import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PortalEditorSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string; group?: string }[]; onChange: (value: string) => void }) {
  const groups = [...new Set(options.map(option => option.group))];
  return <Select value={value} onValueChange={next => { if (next !== null) onChange(next); }}><SelectTrigger size="sm" aria-label={label} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{groups.map(group => <SelectGroup key={group ?? "default"}>{group && <SelectLabel>{group}</SelectLabel>}{options.filter(option => option.group === group).map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup>)}</SelectContent></Select>;
}
