"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { analyticsDay, shiftDay } from "@/lib/analytics-dashboard";
import { type HomeRange, validHomeDate } from "@/lib/home";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/language-provider";

const HomeDateCalendar = dynamic(() => import("@/components/home-date-calendar").then(module => module.HomeDateCalendar), { loading: () => <div role="status" className="h-[240px] w-full animate-pulse rounded-lg bg-muted/40">Loading calendar…</div> });
const localDate = (value: string) => validHomeDate(value) ? new Date(`${value}T12:00:00`) : undefined;
const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function homeRangeLabel(range: HomeRange, today: string, locale = "en-GB") {
  if (range.from === today && range.to === today) return "Today";
  const yesterday = shiftDay(today, -1);
  if (range.from === yesterday && range.to === yesterday) return "Yesterday";
  const format = (day: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: day.slice(0, 4) !== today.slice(0, 4) ? "numeric" : undefined }).format(localDate(day));
  return range.from === range.to ? format(range.from) : `${format(range.from)} – ${format(range.to)}`;
}

export function HomeDateRange({ range, minDate, asOf, disabled, onApply }: { range: HomeRange; minDate: string; asOf: string; disabled: boolean; onApply: (range: HomeRange) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range);
  const [calendarKey, setCalendarKey] = useState(0);
  const { language, t } = useLanguage();
  const today = analyticsDay(asOf), locale = language === "zh-CN" ? "zh-CN" : "en-GB";
  const presets = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: shiftDay(today, -1), to: shiftDay(today, -1) },
    { label: "Last 7 days", from: shiftDay(today, -6), to: today },
    { label: "Last 30 days", from: shiftDay(today, -29), to: today },
    { label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
    { label: "This quarter", from: `${today.slice(0, 4)}-${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`, to: today },
    { label: "All time", from: minDate, to: today },
  ];
  const valid = validHomeDate(draft.from) && validHomeDate(draft.to) && draft.from >= "1900-01-01" && draft.from <= draft.to && draft.to <= today;
  const selected: DateRange | undefined = localDate(draft.from) ? { from: localDate(draft.from), to: localDate(draft.to) } : undefined;
  const setTypedDate = (field: "from" | "to", value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    if (validHomeDate(value)) setCalendarKey(current => current + 1);
  };
  return <Popover open={open} onOpenChange={next => { if (next) setDraft(range); setOpen(next); }}>
    <PopoverTrigger disabled={disabled} className="home-date-trigger" aria-label={`${t("Sales reporting period")}: ${t(homeRangeLabel(range, today, locale))}`}>
      <span>{homeRangeLabel(range, today, locale)}</span><ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} className="home-date-popup !w-[min(632px,calc(100vw-2rem))] !gap-0 overflow-y-auto !rounded-xl !p-0" aria-label="Sales reporting period">
      <PopoverTitle className="sr-only">Choose reporting dates</PopoverTitle>
      <div className="home-date-layout">
        <nav aria-label="Date range presets" className="home-date-presets">{presets.map(preset => <button type="button" key={preset.label} aria-pressed={draft.from === preset.from && draft.to === preset.to} onClick={() => { setDraft({ from: preset.from, to: preset.to }); setCalendarKey(current => current + 1); }}>{preset.label}</button>)}<span className="mt-2 border-t pt-2 text-xs text-muted-foreground">Custom range</span></nav>
        <div className="min-w-0 p-3">
          <div className="mb-3 flex items-end gap-2"><label className="min-w-0 flex-1"><span className="mb-1 block text-xs text-muted-foreground">Start date</span><input type="date" value={draft.from} min="1900-01-01" max={today} onChange={event => setTypedDate("from", event.target.value)} className="home-range-input" /></label><ArrowRight className="mb-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><label className="min-w-0 flex-1"><span className="mb-1 block text-xs text-muted-foreground">End date</span><input type="date" value={draft.to} min={draft.from || "1900-01-01"} max={today} onChange={event => setTypedDate("to", event.target.value)} className="home-range-input" /></label></div>
          {open ? <HomeDateCalendar key={calendarKey} today={localDate(today)!} selected={selected} onSelect={selection => setDraft({ from: selection?.from ? dateValue(selection.from) : "", to: selection?.to ? dateValue(selection.to) : "" })} /> : null}
          <p className="mt-2 text-[10px] text-muted-foreground">Reporting timezone: UTC+8</p>
          {!valid ? <p role="status" className="mt-2 text-xs text-muted-foreground">Choose a valid start and end date, up to today.</p> : null}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t px-3 py-2.5"><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button><Button size="sm" disabled={!valid} onClick={() => { if (valid) { onApply(draft); setOpen(false); } }}>Apply</Button></div>
    </PopoverContent>
  </Popover>;
}
