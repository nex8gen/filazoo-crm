"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function AnalyticsChart({ data, metric, currency, locale }: { data: { date: string; companies: number; collected: number }[]; metric: "companies" | "collected"; currency: string; locale: string }) {
  const money = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  return <div className="h-[250px] min-w-0 w-full text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/70 [&_.recharts-layer]:outline-hidden"><ResponsiveContainer width="100%" height={250} minWidth={0} initialDimension={{ width: 800, height: 250 }}>
    <AreaChart accessibilityLayer data={data} margin={{ left: 0, right: 12, top: 12, bottom: 4 }}>
      <defs><linearGradient id="analytics-trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#059669" stopOpacity={0.18} /><stop offset="100%" stopColor="#059669" stopOpacity={0.01} /></linearGradient></defs>
      <CartesianGrid vertical={false} strokeDasharray="3 4" />
      <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={35} tickMargin={10} tickFormatter={date => String(date).slice(5)} />
      <YAxis axisLine={false} tickLine={false} width={52} allowDecimals={metric === "collected"} tickFormatter={value => new Intl.NumberFormat(locale, { notation: "compact" }).format(Number(value))} />
      <Tooltip formatter={value => [metric === "collected" ? money(Number(value)) : Number(value).toLocaleString(locale), metric === "collected" ? "Cash collected" : "New companies"]} contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} />
      <Area dataKey={metric} type="linear" stroke="#059669" strokeWidth={2} fill="url(#analytics-trend-fill)" isAnimationActive={false} />
    </AreaChart>
  </ResponsiveContainer></div>;
}
