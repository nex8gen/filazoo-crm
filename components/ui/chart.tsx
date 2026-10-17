"use client"

import * as React from "react"
import { cn } from "cn"
import * as RechartsPrimitive from "recharts"

const THEMES = { light: "", dark: ".dark" } as const

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colors = Object.entries(config).filter(([, item]) => item.theme ?? item.color)
  if (!colors.length) return null

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(([theme, prefix]) => `${prefix} [data-chart=${id}] {\n${colors
            .map(([key, item]) => {
              const color = item.theme?.[theme as keyof typeof item.theme] ?? item.color
              return color ? `  --color-${key}: ${color};` : null
            })
            .join("\n")}\n}`)
          .join("\n"),
      }}
    />
  )
}

function ChartContainer({ id, className, children, config, ...props }: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"]
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`

  return (
    <div
      data-slot="chart"
      data-chart={chartId}
      className={cn(
        "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/70 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-layer]:outline-hidden [&_.recharts-surface]:outline-hidden",
        className
      )}
      {...props}
    >
      <ChartStyle id={chartId} config={config} />
      <RechartsPrimitive.ResponsiveContainer initialDimension={{ width: 800, height: 300 }}>
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  )
}

export { ChartContainer, ChartStyle }
