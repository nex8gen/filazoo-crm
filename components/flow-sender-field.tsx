"use client";

import { useId } from "react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FlowSenderField({ value, onChange, options, disabled }: {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string; disabled?: boolean }[];
  disabled: boolean;
}) {
  const id = useId();
  const selected = options.find((option) => option.id === value);
  return <div className="space-y-2">
    <Label htmlFor={id}>Send from</Label>
    <Select value={value} onValueChange={(next) => next && onChange(next)} disabled={disabled}>
      <SelectTrigger id={id} aria-describedby={`${id}-help`} className="h-auto min-h-9 w-full text-left [&_[data-slot=select-value]]:whitespace-normal">
        <SelectValue>{selected?.label || "Selected email is unavailable"}</SelectValue>
      </SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
    <p id={`${id}-help`} className="text-xs leading-5 text-muted-foreground">Choose the workflow owner&apos;s personal email or a shared team email for this action. <Link href="/settings/apps" className="underline underline-offset-2">Manage email accounts</Link></p>
    {!selected || selected.disabled ? <p role="status" className="text-xs text-destructive">Connect this email account or choose another sender before going live.</p> : null}
  </div>;
}
