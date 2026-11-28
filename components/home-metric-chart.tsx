"use client";

import { AnalyticsTrendPlot, type TrendPoint } from "@/components/ui/analytics-chart-card";
import type { HomeValuePoint } from "@/lib/home-metrics";
import styles from "./analytics-trends.module.css";

const dateLabel = (value: string, localHour?: number) => new Intl.DateTimeFormat("en-GB", value.includes("T") ? { timeZone: localHour === undefined ? "Asia/Shanghai" : "UTC", hour: "numeric", hour12: true } : { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(value));

export function HomeMetricChart({ points, currentLabel, previousLabel, asOf, format = "count", currency = "USD", size = "full" }: { points: HomeValuePoint[]; currentLabel: string; previousLabel: string; asOf: string; format?: "count" | "money" | "percent"; currency?: string; size?: "full" | "sparkline" }) {
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
  const formatValue = (value: number) => format === "money" ? money.format(value / 100) : format === "percent" ? `${Number(value.toFixed(1))}%` : value.toLocaleString();
  const data: TrendPoint[] = points.map(point => ({
    tick: dateLabel(point.date, point.localHour),
    period: `${currentLabel} · ${dateLabel(point.date, point.localHour)}`,
    value: (point.available ?? (!point.date.includes("T") || Date.parse(point.date) <= Date.parse(asOf))) ? point.current : null,
    previousPeriod: `${previousLabel} · ${dateLabel(point.previousDate, point.localHour)}`,
    previous: point.previous,
  }));

  if (size === "sparkline") return <AnalyticsTrendPlot data={data} currentLabel={currentLabel} formatValue={formatValue}
    label={`${currentLabel} trend`} size="sparkline" />;

  return <div className={styles.card}>
    <AnalyticsTrendPlot data={data} currentLabel={currentLabel} previousLabel={previousLabel} formatValue={formatValue}
      label="Selected period compared with previous period" size="full" />
    <div className={styles.legend}>
      <span><i aria-hidden="true" />{currentLabel}</span>
      <span><i aria-hidden="true" data-previous />{previousLabel}</span>
    </div>
    <table className="sr-only">
      <caption>Chart values for selected and previous periods</caption>
      <thead><tr><th scope="col">Selected date / hour</th><th scope="col">Selected</th><th scope="col">Previous date / hour</th><th scope="col">Previous</th></tr></thead>
      <tbody>{data.map((point, index) => <tr key={points[index].date}>
        <th scope="row">{points[index].date}</th><td>{point.value === null ? "—" : formatValue(point.value)}</td>
        <td>{points[index].previousDate}</td><td>{point.previous === null ? "—" : formatValue(point.previous)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
