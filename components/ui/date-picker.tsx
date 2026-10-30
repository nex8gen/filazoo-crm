"use client";

import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarDays } from "lucide-react";
import { cn } from "cn";
import { useLanguage } from "@/components/language-provider";
import { parsePickerDate, pickerDateValue, pickerSelection, validPickerValue } from "@/lib/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const MultiMonthCalendar = dynamic(() => import("@/components/ui/calendar").then(module => module.MultiMonthCalendar));

export type DatePickerProps = {
  value: string;
  onValueChange: (value: string) => void;
  includeTime?: boolean;
  id?: string;
  name?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

export function DatePicker({ value, onValueChange, includeTime = false, id, name, min, max, required, disabled, className, placeholder, ...aria }: DatePickerProps) {
  const { language } = useLanguage();
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const timeId = generatedId + "-time";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const validationRef = useRef<HTMLInputElement>(null);
  const selected = parsePickerDate(value);
  const minDate = min ? parsePickerDate(min) : undefined;
  const maxDate = max ? parsePickerDate(max) : undefined;
  const valid = validPickerValue(value, includeTime, min, max);
  const copy = (en: string, zh: string) => language === "zh-CN" ? zh : en;
  const invalidMessage = copy("Choose a valid date within the allowed range.", "请选择允许范围内的有效日期。");

  useEffect(() => {
    validationRef.current?.setCustomValidity(valid ? "" : invalidMessage);
  }, [valid, invalidMessage]);

  const display = selected
    ? selected.toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" }) + (includeTime ? " · " + (value.split("T")[1] ?? "") : "")
    : placeholder ?? copy(includeTime ? "Choose date & time" : "Choose date", includeTime ? "选择日期与时间" : "选择日期");

  return (
    <span data-slot="date-picker" className="relative block min-w-0">
      {/* Keep required/name validation and FormData behavior for button-based fields. */}
      <input ref={validationRef} type="text" name={name} value={value} required={required} disabled={disabled} tabIndex={-1} aria-hidden="true" className="sr-only" onChange={event => onValueChange(event.target.value)} onInvalid={event => { event.preventDefault(); setOpen(true); triggerRef.current?.focus(); }} />
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger render={<button type="button" ref={triggerRef} id={triggerId} disabled={disabled} {...aria} aria-invalid={!valid || undefined} className={cn("flex min-h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm font-normal outline-none hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive", !selected && "text-muted-foreground", className)} />}>
          <span className="truncate">{display}</span><CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={aria["aria-label"] ?? copy("Choose date", "选择日期")} className="w-fit max-w-[calc(100vw-1rem)] max-h-[min(var(--available-height),85dvh)] overflow-y-auto p-3">
          {open ? <MultiMonthCalendar mode="single" required={required} selected={selected} defaultMonth={selected ?? minDate ?? maxDate} disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]} onSelect={(date: Date | undefined) => {
            onValueChange(date ? pickerSelection(date, value, includeTime) : "");
            if (!includeTime) setOpen(false);
          }} /> : null}
          {includeTime ? <div className="flex items-center justify-between gap-4 border-t pt-3">
            <label htmlFor={timeId} className="text-sm">{copy("Time (local)", "时间（本地）")}</label>
            <Input id={timeId} type="time" step={value.split("T")[1]?.length > 5 ? "any" : 60} aria-label={copy("Time (local)", "时间（本地）")} className="w-36" value={value.split("T")[1] ?? ""} min={min?.slice(0, 10) === value.slice(0, 10) ? min.split("T")[1] : undefined} max={max?.slice(0, 10) === value.slice(0, 10) ? max.split("T")[1] : undefined} onChange={event => onValueChange(event.target.value ? (selected ? pickerDateValue(selected) : pickerDateValue(new Date())) + "T" + event.target.value : "")} />
          </div> : null}
          {!valid ? <p role="alert" className="text-xs text-destructive">{invalidMessage}</p> : null}
          <div className="flex justify-end gap-2 border-t pt-2">
            {!required ? <Button type="button" variant="ghost" size="sm" onClick={() => { onValueChange(""); setOpen(false); }}>{copy("Clear", "清除")}</Button> : null}
            <Button type="button" size="sm" onClick={() => setOpen(false)}>{copy("Done", "完成")}</Button>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}
