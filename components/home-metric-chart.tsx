"use client";

import { useId, useState } from "react";
import type { HomeValuePoint } from "@/lib/home-metrics";

const dateLabel = (value: string) => new Intl.DateTimeFormat("en-GB", value.includes("T") ? { timeZone: "Asia/Shanghai", hour: "numeric", hour12: true } : { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(value));

export function HomeMetricChart({ points, currentLabel, previousLabel, asOf, format = "count", currency = "USD" }: { points: HomeValuePoint[]; currentLabel: string; previousLabel: string; asOf: string; format?: "count" | "money" | "percent"; currency?: string }) {
  const id = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const width = 600, height = 240, left = format === "money" ? 58 : 40, right = 12, top = 16, bottom = 36;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const visibleCurrent = (point: HomeValuePoint) => point.current !== null && (!point.date.includes("T") || Date.parse(point.date) <= Date.parse(asOf));
  const max = Math.max(1, ...points.flatMap(point => [visibleCurrent(point) ? point.current! : 0, point.previous ?? 0]));
  const ceiling = Math.max(4, Math.ceil(max / 4) * 4);
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
  const compactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  const valueLabel = (value: number | null, compact = false) => value === null ? "—" : format === "money" ? (compact ? compactMoney : money).format(value / 100) : format === "percent" ? `${Number(value.toFixed(1))}%` : value.toLocaleString();
  const x = (index: number) => left + (points.length === 1 ? plotWidth / 2 : index / (points.length - 1) * plotWidth);
  const y = (value: number) => top + plotHeight - value / ceiling * plotHeight;
  const path = (field: "current" | "previous") => {
    let drawing = false;
    return points.map((point, index) => {
      const value = point[field];
      if (value === null || (field === "current" && !visibleCurrent(point))) { drawing = false; return ""; }
      const command = drawing ? "L" : "M"; drawing = true;
      return `${command}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    }).join(" ");
  };
  const shown = selected === null ? null : points[selected];
  const latestCurrent = points.reduce((latest, point, index) => visibleCurrent(point) ? index : latest, -1);
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1])];
  return <div className="relative">
    {shown ? <div className="pointer-events-none absolute left-14 top-0 z-10 rounded-md border bg-popover/95 px-2.5 py-1.5 text-[10px] shadow-sm" aria-live="polite">{dateLabel(shown.date)} · {valueLabel(visibleCurrent(shown) ? shown.current : null)} / {valueLabel(shown.previous)}</div> : null}
    <svg viewBox={`0 0 ${width} ${height}`} className="home-metric-chart" role="img" aria-labelledby={`${id}-title ${id}-description`}
      onPointerMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); const pointerX = (event.clientX - bounds.left) / bounds.width * width; setSelected(Math.max(0, Math.min(points.length - 1, Math.round((pointerX - left) / plotWidth * (points.length - 1))))); }} onPointerLeave={() => setSelected(null)}>
      <title id={`${id}-title`}>Selected period compared with previous period</title><desc id={`${id}-description`}>Solid line: selected period. Dashed line: previous period. Values are listed in the accessible data table.</desc>
      {[0, 1, 2, 3, 4].map(index => { const value = ceiling * index / 4; return <g key={index}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="var(--border)" strokeWidth="1" /><text x={left - 10} y={y(value) + 4} textAnchor="end" className="home-chart-label">{valueLabel(value, true)}</text></g>; })}
      <path d={path("previous")} fill="none" stroke="#9bcce5" strokeWidth="2" strokeDasharray="3 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={path("current")} fill="none" stroke="#12a8e2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.length === 1 && points[0].previous !== null ? <circle cx={x(0)} cy={y(points[0].previous)} r="4" fill="#9bcce5" /> : null}
      {latestCurrent >= 0 ? <circle cx={x(latestCurrent)} cy={y(points[latestCurrent].current!)} r="3.5" fill="#12a8e2" /> : null}
      {ticks.map(index => <text key={index} x={x(index)} y={height - 10} textAnchor={points.length === 1 ? "middle" : index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className="home-chart-label">{dateLabel(points[index].date)}</text>)}
      {shown && selected !== null ? <g><line x1={x(selected)} x2={x(selected)} y1={top} y2={height - bottom} stroke="var(--muted-foreground)" strokeOpacity=".35" strokeDasharray="3 3" />{visibleCurrent(shown) ? <circle cx={x(selected)} cy={y(shown.current!)} r="4" fill="#12a8e2" /> : null}{shown.previous !== null ? <circle cx={x(selected)} cy={y(shown.previous)} r="4" fill="#9bcce5" /> : null}</g> : null}
    </svg>
    <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-2"><i aria-hidden="true" className="size-2 rounded-full bg-[#12a8e2]" />{currentLabel}</span><span className="inline-flex items-center gap-2"><i aria-hidden="true" className="size-2 rounded-full bg-[#9bcce5]" />{previousLabel}</span></div>
    <table className="sr-only"><caption>Chart values for selected and previous periods</caption><thead><tr><th scope="col">Selected date / hour</th><th scope="col">Selected</th><th scope="col">Previous date / hour</th><th scope="col">Previous</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><th scope="row">{point.date}</th><td>{valueLabel(visibleCurrent(point) ? point.current : null)}</td><td>{point.previousDate}</td><td>{valueLabel(point.previous)}</td></tr>)}</tbody></table>
  </div>;
}
