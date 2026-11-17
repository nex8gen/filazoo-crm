"use client";

import { useState } from "react";
import { Clock3 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TimePickerProps = {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

/** A controlled 24-hour picker built from the same controls as our date picker. */
export function TimePicker({ value, onValueChange, id, disabled, className, "aria-label": ariaLabel = "Choose time" }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const [hour, minute] = valid ? value.split(":") : ["", ""];
  const change = (part: "hour" | "minute", next: string | null) => {
    if (disabled || next === null) return;
    onValueChange(part === "hour" ? `${next}:${minute || "00"}` : `${hour || "00"}:${next}`);
  };

  return <Popover open={open && !disabled} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" id={id} variant="outline" disabled={disabled} aria-label={ariaLabel} className={cn("min-h-10 w-full justify-between font-normal", className)} />}>
      <span className={valid ? "tabular-nums" : "text-muted-foreground"}>{valid ? value : "Choose time"}</span><Clock3 aria-hidden="true" className="size-4 text-muted-foreground" />
    </PopoverTrigger>
    <PopoverContent align="start" aria-label={ariaLabel} className="w-60 max-w-[calc(100vw-1rem)] gap-4 p-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div className="grid min-w-0 gap-2"><Label className="text-xs text-muted-foreground">Hours</Label><Select value={hour} disabled={disabled} onValueChange={next => change("hour", next)}><SelectTrigger aria-label="Hours" className="w-full tabular-nums"><SelectValue placeholder="00" /></SelectTrigger><SelectContent>{hours.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
        <span aria-hidden="true" className="pb-2.5 text-muted-foreground">:</span>
        <div className="grid min-w-0 gap-2"><Label className="text-xs text-muted-foreground">Minutes</Label><Select value={minute} disabled={disabled} onValueChange={next => change("minute", next)}><SelectTrigger aria-label="Minutes" className="w-full tabular-nums"><SelectValue placeholder="00" /></SelectTrigger><SelectContent>{minutes.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="flex justify-end"><Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Done</Button></div>
    </PopoverContent>
  </Popover>;
}
