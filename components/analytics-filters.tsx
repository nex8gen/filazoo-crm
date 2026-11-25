"use client";

import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { HomeDateRange } from "@/components/home-date-range";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import {
  analyticsChannels, channelLabels, shiftDay,
  type AnalyticsDashboardData, type AnalyticsFiltersValue,
} from "@/lib/analytics-dashboard";
import styles from "./analytics-filters.module.css";

export function initialAnalyticsFilters(data: AnalyticsDashboardData): AnalyticsFiltersValue {
  return {
    from: shiftDay(data.maxDate, -29),
    to: data.maxDate,
    channel: "all",
    owner: "all",
    currency: data.currencies.includes("USD") ? "USD" : data.currencies[0] ?? "USD",
    comparison: "previous_period",
  };
}

type AnalyticsFiltersProps = {
  value: AnalyticsFiltersValue;
  data: AnalyticsDashboardData;
  onChange: (value: AnalyticsFiltersValue) => void;
};

export function AnalyticsFilters({ value, data, onChange }: AnalyticsFiltersProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const activeCount = Number(value.channel !== "all") + Number(value.owner !== "all") + Number(value.comparison !== "previous_period");

  return (
    <div className={`home-overview-date ${styles.filterGroup}`} role="group" aria-label={t("Filters")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className={styles.filterButton} aria-label={t("Filters") + " · " + value.currency} title={t("Filters")}>
          <SlidersHorizontal aria-hidden="true" className="size-3.5" />
          <span className={styles.currency}>{value.currency}</span>
          {activeCount > 0 && <span className={styles.count}>{activeCount}</span>}
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className={styles.popup}>
          <PopoverTitle>Filters</PopoverTitle>
          <label className={styles.field}>
            <span>Comparison</span>
            <select className={styles.control} value={value.comparison} onChange={event => {
              onChange({ ...value, comparison: event.target.value as AnalyticsFiltersValue["comparison"] });
            }}>
              <option value="previous_period">Previous period</option>
              <option value="previous_year">Previous year</option>
              <option value="none">Comparison off</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Currency</span>
            <select className={styles.control} value={value.currency} onChange={event => onChange({ ...value, currency: event.target.value })}>
              {data.currencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Company source</span>
            <select className={styles.control} value={value.channel} onChange={event => {
              onChange({ ...value, channel: event.target.value as AnalyticsFiltersValue["channel"] });
            }}>
              <option value="all">All sources</option>
              {analyticsChannels.map(channel => <option key={channel} value={channel}>{channelLabels[channel]}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Account owner</span>
            <select className={styles.control} value={value.owner} onChange={event => onChange({ ...value, owner: event.target.value })}>
              <option value="all">All owners</option>
              <option value="unassigned">Unassigned</option>
              {data.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
            </select>
          </label>
          <Button type="button" variant="ghost" size="sm" className={styles.reset} onClick={() => {
            onChange(initialAnalyticsFilters(data));
            setOpen(false);
          }}>
            <RotateCcw aria-hidden="true" />Reset filters
          </Button>
        </PopoverContent>
      </Popover>
      <HomeDateRange range={value} minDate={data.minDate} asOf={data.asOf} align="end" label="Reporting period"
        onChange={({ from, to }) => onChange({ ...value, from, to })} />
    </div>
  );
}
