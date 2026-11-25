"use client";

import { useId } from "react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { selectedFlowSender } from "@/lib/flow-mailboxes";

export function FlowSenderField({ value, onChange, options, disabled, compact = false, assignedSender = false }: {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string; disabled?: boolean; aliases?: string[] }[];
  disabled: boolean;
  compact?: boolean;
  assignedSender?: boolean;
}) {
  const id = useId();
  const selected = selectedFlowSender(options, value);
  if (assignedSender) return <div className="space-y-2">
    <Label>Send from</Label>
    <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">Assigned user&apos;s personal email, otherwise team email</p>
    <p className="text-xs leading-5 text-muted-foreground">Controlled by the workflow trigger. Turn this option off in Trigger settings to choose a fixed sender.</p>
  </div>;
  return <div className="space-y-2">
    <Label htmlFor={id}>Send from</Label>
    <Select value={selected?.id ?? value} onValueChange={(next) => next && onChange(next)} disabled={disabled || options.length === 0}>
      <SelectTrigger id={id} aria-describedby={compact ? undefined : `${id}-help`} className="h-auto min-h-9 w-full text-left [&_[data-slot=select-value]]:whitespace-normal">
        <SelectValue>{selected?.label || (options.length ? "Selected email is unavailable" : "No email accounts connected")}</SelectValue>
      </SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
    {!compact ? <p id={`${id}-help`} className="text-xs leading-5 text-muted-foreground">Choose your own email account or a shared team email. Other members&apos; personal email accounts cannot be used. <Link href="/settings/apps" className="underline underline-offset-2">Manage email accounts</Link></p> : null}
    {!selected || selected.disabled ? <p role="status" className="text-xs text-destructive">Connect this email account or choose another sender before going live.{compact ? <> <Link href="/settings/apps" className="underline underline-offset-2">Manage accounts</Link></> : null}</p> : null}
  </div>;
}
