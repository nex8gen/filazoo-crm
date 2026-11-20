"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, Minus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { companyListAnalytics } from "@/lib/company-list-analytics";
import type { Company } from "@/lib/types";
import "./company-list-analytics.css";

function Sparkline({ points, previousPoints }: { points: number[]; previousPoints: number[] }) {
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
    <path d={`${currentPath} L79,28 L1,28 Z`} fill="currentColor" fillOpacity=".06" />
    <path className="company-analytics-previous-line" d={path(previousPoints)} stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
    <path d={currentPath} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function CompanyListAnalytics({ companies, asOf }: { companies: Company[]; asOf: string }) {
  const [period, setPeriod] = useState("7");
  const metrics = useMemo(() => companyListAnalytics(companies, Number(period), asOf), [companies, period, asOf]);
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
    <dl className="company-analytics-metrics">
      {metrics.map(metric => <div key={metric.label} className="company-analytics-metric" title={`${metric.detail} Compared with companies added in the preceding ${period} days. Solid line: selected period; dotted line: preceding period. Search and filters apply.`}>
        <dt className="company-analytics-label">{metric.label}</dt>
        <dd className="company-analytics-reading">
          <div className="company-analytics-figures">
            <span className="company-analytics-value">{number.format(metric.value)}{metric.percentage ? "%" : ""}</span>
            <span className={`company-analytics-change ${metric.change !== null && metric.change > 0 ? "company-analytics-positive" : ""}`} title={metric.change === null ? "No previous baseline" : "Compared with the previous period"} aria-label={metric.change === null ? "No previous baseline" : `${number.format(Math.abs(metric.change))}% ${metric.change >= 0 ? "increase" : "decrease"} compared with the preceding period`}>
              {metric.change === null || metric.change === 0 ? <Minus aria-hidden="true" /> : metric.change > 0 ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}
              {metric.change !== null && `${number.format(Math.abs(metric.change))}%`}
            </span>
          </div>
          <Sparkline points={metric.points} previousPoints={metric.previousPoints} />
        </dd>
      </div>)}
    </dl>
  </section>;
}
