"use client";

import { analyticsChannels, channelLabels, shiftDay, type AnalyticsDashboardData, type AnalyticsFiltersValue } from "@/lib/analytics-dashboard";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";

const control = "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function initialAnalyticsFilters(data: AnalyticsDashboardData): AnalyticsFiltersValue {
  return { from: shiftDay(data.maxDate, -29), to: data.maxDate, channel: "all", owner: "all", currency: data.currencies.includes("USD") ? "USD" : data.currencies[0] ?? "USD", comparison: "previous_period" };
}
export function AnalyticsFilters({ value, data, onChange }: { value: AnalyticsFiltersValue; data: AnalyticsDashboardData; onChange: (value: AnalyticsFiltersValue) => void }) {
  return <div className="rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <div className="flex flex-wrap gap-1" aria-label="Reporting period">{[{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }, { label: "All time", days: 0 }].map(preset => {
        const from = preset.days ? shiftDay(data.maxDate, 1 - preset.days) : data.minDate;
        const selected = value.from === from && value.to === data.maxDate;
        return <button type="button" key={preset.label} aria-pressed={selected} onClick={() => onChange({ ...value, from, to: data.maxDate })} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${selected ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}>{preset.label}</button>;
      })}</div>
      <Button variant="ghost" size="xs" onClick={() => onChange(initialAnalyticsFilters(data))}><RotateCcw className="size-3" />Reset filters</Button>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <label className="space-y-1.5 text-xs text-muted-foreground">From<DatePicker aria-label="From date" required className={control} value={value.from} max={value.to} onValueChange={from => { if (from && from <= value.to) onChange({ ...value, from }); }} /></label>
      <label className="space-y-1.5 text-xs text-muted-foreground">To<DatePicker aria-label="To date" required className={control} value={value.to} min={value.from} max={data.maxDate} onValueChange={to => { if (to && to >= value.from && to <= data.maxDate) onChange({ ...value, to }); }} /></label>
      <label className="space-y-1.5 text-xs text-muted-foreground">Company source<select aria-label="Company source" className={control} value={value.channel} onChange={event => onChange({ ...value, channel: event.target.value as AnalyticsFiltersValue["channel"] })}><option value="all">All sources</option>{analyticsChannels.map(channel => <option key={channel} value={channel}>{channelLabels[channel]}</option>)}</select></label>
      <label className="space-y-1.5 text-xs text-muted-foreground">Account owner<select aria-label="Account owner" className={control} value={value.owner} onChange={event => onChange({ ...value, owner: event.target.value })}><option value="all">All owners</option><option value="unassigned">Unassigned</option>{data.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
      <label className="space-y-1.5 text-xs text-muted-foreground">Currency<select aria-label="Currency" className={control} value={value.currency} onChange={event => onChange({ ...value, currency: event.target.value })}>{data.currencies.map(currency => <option key={currency}>{currency}</option>)}</select></label>
      <label className="col-span-2 space-y-1.5 text-xs text-muted-foreground">Compare activity with<select aria-label="Comparison" className={control} value={value.comparison} onChange={event => onChange({ ...value, comparison: event.target.value as AnalyticsFiltersValue["comparison"] })}><option value="previous_period">Previous period</option><option value="previous_year">Previous year</option><option value="none">Comparison off</option></select></label>
    </div>
    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Reporting timezone: Asia/Shanghai. Source and owner filter company-linked reports. Currency filters monetary reports and catalogs; amounts are not converted. Personal and workspace activity use the date range only.</p>
  </div>;
}
