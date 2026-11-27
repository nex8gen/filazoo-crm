"use client";

import { useId, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, Minus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { companyListAnalytics } from "@/lib/company-list-analytics";
import type { Company } from "@/lib/types";
import { companyListBucketAnalytics, type CompanyAnalyticsBucket } from "@/lib/company-list";
import surfaces from "./analytics-surface.module.css";
import "./company-list-analytics.css";

function Sparkline({ points, previousPoints }: { points: number[]; previousPoints: number[] }) {
  const id = useId();
  const strokeId = `${id}-stroke`;
  const fillId = `${id}-fill`;
  const maximum = Math.max(1, ...points, ...previousPoints);
  const path = (values: number[]) => values.map((value, index) => {
    const x = index / (values.length - 1) * 78 + 1;
    const y = 25 - value / maximum * 22;
    if (!index) return `M${x.toFixed(2)},${y.toFixed(2)}`;
    const previousX = (index - 1) / (values.length - 1) * 78 + 1;
    const previousY = 25 - values[index - 1] / maximum * 22;
    const middleX = (previousX + x) / 2;
    return `C${middleX.toFixed(2)},${previousY.toFixed(2)} ${middleX.toFixed(2)},${y.toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const currentPath = path(points);
  return <svg aria-hidden="true" viewBox="0 0 80 28" className="company-analytics-sparkline" fill="none">
    <defs>
      <linearGradient id={strokeId} gradientUnits="userSpaceOnUse" x1="1" x2="79" y1="0" y2="0">
        <stop stopColor="#fa937c" /><stop offset=".43" stopColor="#e65596" /><stop offset="1" stopColor="#5886de" />
      </linearGradient>
      <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
        <stop stopColor="#efa6ca" stopOpacity=".35" /><stop offset="1" stopColor="#9cbfff" stopOpacity=".02" />
      </linearGradient>
    </defs>
    <path d={`${currentPath} L79,28 L1,28 Z`} fill={`url(#${fillId})`} />
    <path d={path(previousPoints)} stroke="#958ca9" strokeWidth="1.1" strokeDasharray="2 2" />
    <path d={currentPath} stroke={`url(#${strokeId})`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function CompanyListAnalytics({ companies = [], buckets, asOf }: { companies?: Company[]; buckets?: CompanyAnalyticsBucket[]; asOf: string }) {
  const [period, setPeriod] = useState("7");
  const metrics = useMemo(() => buckets ? companyListBucketAnalytics(buckets, Number(period)) : companyListAnalytics(companies, Number(period), asOf), [companies, buckets, period, asOf]);
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

  return <section aria-label="Company and customer analytics" className="company-analytics-strip">
    <div className="company-analytics-period">
      <h2 className="company-analytics-heading"><ChartNoAxesCombined aria-hidden="true" />Overview</h2>
      <Select value={period} onValueChange={value => { if (value) setPeriod(value); }}>
        <SelectTrigger aria-label="Analytics period" className="company-analytics-period-trigger">
          <CalendarDays aria-hidden="true" className="size-3.5" /><SelectValue />
        </SelectTrigger>
        <SelectContent><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem><SelectItem value="90">90 days</SelectItem></SelectContent>
      </Select>
    </div>
    <div className="company-analytics-metrics">
      {metrics.map(metric => <article key={metric.label} className={surfaces.kpi} title={`${metric.detail} Compared with companies added in the preceding ${period} days. Solid line: selected period; dotted line: preceding period. Search and filters apply.`}>
        <div className={surfaces.kpiText}>
          <h3 className={surfaces.title}>{metric.label}</h3>
          <div className={surfaces.readout}>
            <strong>{number.format(metric.value)}{metric.percentage ? "%" : ""}</strong>
            <span className={surfaces.change} data-up={metric.change !== null && metric.change > 0} title={metric.change === null ? "No previous baseline" : "Compared with the previous period"} aria-label={metric.change === null ? "No previous baseline" : `${number.format(Math.abs(metric.change))}% ${metric.change >= 0 ? "increase" : "decrease"} compared with the preceding period`}>
              {metric.change === null ? <Minus aria-hidden="true" size={12} /> : metric.change > 0 ? <ArrowUpRight aria-hidden="true" size={12} /> : metric.change < 0 ? <ArrowDownRight aria-hidden="true" size={12} /> : null}
              {metric.change !== null && `${number.format(Math.abs(metric.change))}%`}
            </span>
          </div>
        </div>
        <Sparkline points={metric.points} previousPoints={metric.previousPoints} />
      </article>)}
    </div>
  </section>;
}
