"use client";

import { useId, type ReactNode } from "react";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TabsContent } from "@/components/ui/tabs";
import styles from "../analytics-trends.module.css";
import surfaces from "../analytics-surface.module.css";

export type TrendPoint = {
  tick: string;
  period: string;
  value: number | null;
  previousPeriod: string;
  previous: number | null;
};

export type AnalyticsChartCardProps = {
  title: string;
  description: string;
  value: string;
  change: number | null;
  data: TrendPoint[];
  currentLabel: string;
  previousLabel?: string;
  formatValue: (value: number) => string;
  formatChange: (change: number) => string;
  unavailableText: string;
  emptyText: string;
  available?: boolean;
  compact?: boolean;
  showDots?: boolean;
  tabs?: { list: ReactNode; value: string };
};

type TrendPlotProps = Pick<AnalyticsChartCardProps, "data" | "currentLabel" | "previousLabel" | "formatValue" | "showDots"> & {
  size: "full" | "compact" | "sparkline" | "chat";
  label: string;
};

export function AnalyticsTrendPlot({ data, currentLabel, previousLabel, formatValue, showDots, size, label }: TrendPlotProps) {
  const chartId = useId();
  const strokeId = `${chartId}-stroke`;
  const fillId = `${chartId}-fill`;
  const fadeId = `${chartId}-fade`;
  const maskId = `${chartId}-mask`;
  const mini = size === "sparkline";
  const compact = size === "compact";
  const chat = size === "chat";
  const height = mini ? 30 : compact ? 144 : chat ? 200 : 256;
  const dot = showDots || data.length === 1 ? { r: mini ? 1.6 : 2, strokeWidth: 0 } : false;

  return (
    <div className={mini ? styles.sparkline : styles.plot} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: mini ? 84 : compact ? 380 : 760, height }}>
        <ComposedChart aria-label={label} accessibilityLayer data={data}
          margin={mini ? { left: 2, right: 2, top: 3, bottom: 3 } : { left: 20, right: 20, top: 18, bottom: 6 }}>
          <defs>
            <linearGradient id={strokeId} gradientUnits="userSpaceOnUse" x1="0%" x2="100%" y1="0%" y2="0%">
              <stop stopColor="#fa937c" /><stop offset=".43" stopColor="#e65596" /><stop offset="1" stopColor="#5886de" />
            </linearGradient>
            <linearGradient id={fillId}>
              <stop stopColor="#ffb39e" /><stop offset=".43" stopColor="#efa6ca" /><stop offset="1" stopColor="#9cbfff" />
            </linearGradient>
            <linearGradient id={fadeId} x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="white" stopOpacity=".78" /><stop offset="1" stopColor="white" stopOpacity=".05" />
            </linearGradient>
            <mask id={maskId} maskContentUnits="objectBoundingBox">
              <rect width="1" height="1" fill={`url(#${fadeId})`} />
            </mask>
          </defs>
          <XAxis hide={mini} dataKey="tick" interval="preserveStartEnd" tickMargin={10} minTickGap={compact || chat ? 38 : 27} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: chat ? 12 : 10 }} />
          <YAxis hide />
          <Tooltip allowEscapeViewBox={{ x: mini, y: mini }} wrapperStyle={mini ? { right: 0, left: "auto", top: "100%", transform: "none", zIndex: 5 } : undefined}
            cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.6 }} content={({ active, payload }) => {
            const point: TrendPoint | undefined = payload?.[0]?.payload;
            if (!active || !point) return null;
            return (
              <div className={styles.tooltip}>
                {point.value !== null && <div><i />{point.period}<b>{formatValue(point.value)}</b></div>}
                {previousLabel && point.previous !== null && <div><i data-previous />{point.previousPeriod}<b>{formatValue(point.previous)}</b></div>}
              </div>
            );
          }} />
          <Area type="monotone" dataKey="value" stroke="none" fill={`url(#${fillId})`} fillOpacity={1}
            mask={`url(#${maskId})`} activeDot={false} dot={false} tooltipType="none" isAnimationActive={false} />
          {previousLabel && <Line type="monotone" dataKey="previous" name={previousLabel} stroke="var(--trend-previous)"
            strokeDasharray={mini ? "2 2" : "3 5"} strokeWidth={mini ? 1.1 : 1.6} dot={dot && { ...dot, fill: "var(--trend-previous)" }} activeDot={{ r: mini ? 2 : 3 }} isAnimationActive={false} />}
          <Line type="monotone" dataKey="value" name={currentLabel} stroke={`url(#${strokeId})`} strokeWidth={mini ? 1.5 : 2.2}
            dot={dot && { ...dot, fill: "var(--trend-current)" }} activeDot={{ r: mini ? 2.5 : 5, fill: "var(--trend-current)", stroke: "var(--card)", strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AnalyticsChartCard({
  title, description, value, change, data, currentLabel, previousLabel, formatValue, formatChange,
  available = true, compact = false, showDots = false, unavailableText, emptyText, tabs,
}: AnalyticsChartCardProps) {
  const titleId = useId();
  const hasData = data.some(point => point.value !== null || point.previous !== null);

  const plot = !available || !hasData ? (
    <p className={styles.empty} role="status">{available ? emptyText : unavailableText}</p>
  ) : (
    <>
      <AnalyticsTrendPlot data={data} currentLabel={currentLabel} previousLabel={previousLabel} formatValue={formatValue}
        label={title} size={compact ? "compact" : "full"} showDots={showDots} />
      <div className={styles.legend}>
        <span><i />{currentLabel}</span>
        {previousLabel && <span><i data-previous />{previousLabel}</span>}
      </div>
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{currentLabel}</th><th scope="col">{title}</th>
              {previousLabel && <><th scope="col">{previousLabel}</th><th scope="col">{title}</th></>}
            </tr>
          </thead>
          <tbody>{data.map((point, index) => (
            <tr key={index}>
              <th scope="row">{point.period}</th><td>{point.value === null ? "—" : formatValue(point.value)}</td>
              {previousLabel && <><td>{point.previousPeriod}</td><td>{point.previous === null ? "—" : formatValue(point.previous)}</td></>}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );

  return (
    <section className={`${surfaces.surface} ${styles.card}`} data-compact={compact} aria-labelledby={titleId}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 id={titleId} className={tabs ? "sr-only" : undefined}>{title}</h2>
          {tabs?.list}
          <p>{description}</p>
        </div>
        <div className={styles.summary}>
          <strong>{available ? value : "—"}</strong>
          {available && change !== null && (
            <span className={styles.change} data-positive={change > 0}>
              {change > 0 ? "↗" : change < 0 ? "↘" : "—"} {formatChange(Math.abs(change))}
            </span>
          )}
        </div>
      </header>
      {tabs ? <TabsContent key={tabs.value} value={tabs.value} className="flex min-w-0 flex-col">{plot}</TabsContent> : plot}
    </section>
  );
}
