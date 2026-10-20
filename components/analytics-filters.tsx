"use client";

import { useMemo, useState } from "react";
import { differenceInCalendarDays, format, startOfQuarter, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarDays, Check, ChevronDown, CircleDollarSign, Filter, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import type { AnalyticsChannel } from "@/lib/analytics-dashboard";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ComparisonMode = "previous_period" | "previous_year" | "none";
export type AnalyticsFiltersValue = {
  range: { from: Date; to: Date };
  channels: AnalyticsChannel[];
  currency: string;
  comparison: ComparisonMode;
};

const channelOptions: { id: AnalyticsChannel; label: string; detail: string; color: string }[] = [
  { id: "meta", label: "Meta", detail: "Facebook, Instagram, and Messenger", color: "bg-blue-500" },
  { id: "store", label: "Direct / Shopify", detail: "Shopify forms, direct, manual, and imported leads", color: "bg-emerald-500" },
  { id: "partner", label: "Partner / referral", detail: "Wholesale partners, resellers, and referrals", color: "bg-amber-500" },
];

function rangeLabel(range: AnalyticsFiltersValue["range"]) {
  if (range.from.getTime() === range.to.getTime()) return format(range.from, "MMM d, yyyy");
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;
}

function FilterChip({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return <span className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium shadow-xs">{children}{onRemove ? <button onClick={onRemove} aria-label="Remove filter" className="rounded-full text-muted-foreground hover:text-foreground"><X className="size-3" /></button> : null}</span>;
}

export function AnalyticsFilters({ value, minDate, maxDate, currencies, onChange, onCustomize }: { value: AnalyticsFiltersValue; minDate: Date; maxDate: Date; currencies: string[]; onChange: (value: AnalyticsFiltersValue) => void; onCustomize: () => void }) {
  const [dateOpen, setDateOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange>({ from: value.range.from, to: value.range.to });
  const [draftComparison, setDraftComparison] = useState<ComparisonMode>(value.comparison);
  const dayCount = differenceInCalendarDays(value.range.to, value.range.from) + 1;
  const allChannels = value.channels.length === channelOptions.length;
  const channelLabel = allChannels ? "All channels" : value.channels.length === 1 ? channelOptions.find((option) => option.id === value.channels[0])?.label : `${value.channels.length} channels`;
  const presets = useMemo(() => [
    { group: "Recent", label: "Today", from: maxDate, to: maxDate },
    { group: "Recent", label: "Yesterday", from: subDays(maxDate, 1), to: subDays(maxDate, 1) },
    { group: "Rolling", label: "Last 7 days", from: subDays(maxDate, 6), to: maxDate },
    { group: "Rolling", label: "Last 14 days", from: subDays(maxDate, 13), to: maxDate },
    { group: "Rolling", label: "Last 30 days", from: subDays(maxDate, 29), to: maxDate },
    { group: "Business", label: "Quarter to date", from: startOfQuarter(maxDate), to: maxDate },
    { group: "Business", label: "All CRM data", from: minDate, to: maxDate },
  ], [maxDate, minDate]);

  const applyDate = () => {
    if (!draftRange.from) return;
    onChange({ ...value, range: { from: draftRange.from, to: draftRange.to ?? draftRange.from }, comparison: draftComparison });
    setDateOpen(false);
  };
  const toggleChannel = (channel: AnalyticsChannel) => {
    const channels = value.channels.includes(channel) ? value.channels.filter((item) => item !== channel) : [...value.channels, channel];
    if (channels.length) onChange({ ...value, channels });
  };
  const reset = () => onChange({ range: { from: new Date(Math.max(minDate.getTime(), subDays(maxDate, 29).getTime())), to: maxDate }, channels: ["meta", "store", "partner"], currency: currencies[0] ?? "USD", comparison: "previous_period" });

  return <div className="space-y-3"><div className="flex flex-wrap items-center gap-2">
    <Popover open={dateOpen} onOpenChange={(open) => { setDateOpen(open); if (open) { setDraftRange({ from: value.range.from, to: value.range.to }); setDraftComparison(value.comparison); } }}><PopoverTrigger render={<Button variant="outline" className="h-9 min-w-48 justify-between px-3" />}><span className="flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" />{rangeLabel(value.range)}</span><ChevronDown className="size-4 text-muted-foreground" /></PopoverTrigger><PopoverContent align="end" className="w-[min(94vw,810px)] gap-0 overflow-hidden p-0"><div className="grid md:grid-cols-[170px_1fr]"><aside className="border-b bg-muted/30 p-2 md:border-b-0 md:border-r">{["Recent", "Rolling", "Business"].map((group) => <div key={group} className="mb-3 last:mb-0"><p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>{presets.filter((preset) => preset.group === group).map((preset) => { const active = draftRange.from?.getTime() === preset.from.getTime() && draftRange.to?.getTime() === preset.to.getTime(); return <button key={preset.label} onClick={() => setDraftRange({ from: preset.from, to: preset.to })} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${active ? "bg-background font-medium shadow-xs" : "hover:bg-muted"}`}>{preset.label}{active ? <Check className="size-3.5 text-primary" /> : null}</button>; })}</div>)}</aside><div><div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center"><div className="flex h-9 flex-1 items-center rounded-lg border bg-background px-3 text-xs"><span className="text-muted-foreground">From</span><strong className="ml-auto font-medium">{draftRange.from ? format(draftRange.from, "MMMM d, yyyy") : "Select date"}</strong></div><span className="hidden text-muted-foreground sm:block">→</span><div className="flex h-9 flex-1 items-center rounded-lg border bg-background px-3 text-xs"><span className="text-muted-foreground">To</span><strong className="ml-auto font-medium">{draftRange.to ? format(draftRange.to, "MMMM d, yyyy") : "Select date"}</strong></div></div><Calendar mode="range" selected={draftRange} onSelect={(range) => range && setDraftRange(range)} numberOfMonths={2} defaultMonth={value.range.from} disabled={{ before: minDate, after: maxDate }} className="mx-auto p-3" /><div className="flex flex-col gap-3 border-t bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-1 rounded-lg border bg-background p-1"><span className="px-2 text-[11px] font-medium text-muted-foreground">Compare</span>{([{ id: "previous_period", label: "Previous period" }, { id: "previous_year", label: "Previous year" }, { id: "none", label: "Off" }] as const).map((option) => <button key={option.id} onClick={() => setDraftComparison(option.id)} className={`rounded-md px-2 py-1 text-[11px] ${draftComparison === option.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}>{option.label}</button>)}</div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDateOpen(false)}>Cancel</Button><Button disabled={!draftRange.from} onClick={applyDate}>Apply</Button></div></div></div></div></PopoverContent></Popover>
    <Popover><PopoverTrigger render={<Button variant="outline" className="h-9 min-w-36 justify-between px-3" />}><span className="flex items-center gap-2"><Filter className="size-4 text-muted-foreground" />{channelLabel}</span><ChevronDown className="size-4 text-muted-foreground" /></PopoverTrigger><PopoverContent align="end" className="w-80 p-2"><div className="px-2 pb-2 pt-1"><p className="text-sm font-medium">Attribution channels</p><p className="text-xs text-muted-foreground">Include one or more acquisition sources.</p></div><div className="space-y-1">{channelOptions.map((option) => <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted"><Checkbox checked={value.channels.includes(option.id)} onCheckedChange={() => toggleChannel(option.id)} className="mt-0.5" /><i className={`mt-1 size-2.5 rounded-full ${option.color}`} /><span><span className="block text-sm font-medium">{option.label}</span><span className="block text-[11px] leading-4 text-muted-foreground">{option.detail}</span></span></label>)}</div><div className="mt-2 flex justify-between border-t px-2 pt-2"><button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange({ ...value, channels: channelOptions.map((option) => option.id) })}>Select all</button><span className="text-xs text-muted-foreground">{value.channels.length} selected</span></div></PopoverContent></Popover>
    <Popover><PopoverTrigger render={<Button variant="outline" className="h-9 min-w-24 justify-between px-3" />}><span className="flex items-center gap-2"><CircleDollarSign className="size-4 text-muted-foreground" />{value.currency}</span><ChevronDown className="size-4 text-muted-foreground" /></PopoverTrigger><PopoverContent align="end" className="w-64 p-2"><p className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">Pipeline currency</p>{currencies.map((currency) => <button key={currency} onClick={() => onChange({ ...value, currency })} className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-muted ${value.currency === currency ? "bg-muted font-medium" : ""}`}><span>{currency}</span>{value.currency === currency ? <Check className="size-4 text-primary" /> : null}</button>)}</PopoverContent></Popover>
    <Button variant="outline" className="h-9" onClick={onCustomize}><SlidersHorizontal />Customize</Button>
  </div><div className="flex flex-wrap items-center gap-2 border-t pt-3"><span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Active filters</span><FilterChip>{dayCount} days</FilterChip><FilterChip>{value.comparison === "previous_period" ? "vs previous period" : value.comparison === "previous_year" ? "vs previous year" : "comparison off"}</FilterChip>{!allChannels ? <FilterChip onRemove={() => onChange({ ...value, channels: channelOptions.map((option) => option.id) })}>{channelLabel}</FilterChip> : null}<FilterChip>{value.currency}</FilterChip><button onClick={reset} className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><RotateCcw className="size-3.5" />Reset view</button></div></div>;
}
