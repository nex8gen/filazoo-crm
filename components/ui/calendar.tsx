"use client"

import * as React from "react"
import { zhCN, enUS } from "react-day-picker/locale"
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { DayPicker, type DayButton, type ChevronProps, type Locale } from "react-day-picker"
import { cn } from "cn"
import { useLanguage } from "@/components/language-provider"
import { Button, buttonVariants } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type MultiMonthCalendarProps = React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}

function Calendar({ className, classNames, showOutsideDays = true, numberOfMonths = 2, buttonVariant = "ghost", locale: suppliedLocale, components, month: controlledMonth, defaultMonth, onMonthChange, startMonth, endMonth, ...props }: MultiMonthCalendarProps) {
  const { language } = useLanguage()
  const locale = suppliedLocale ?? (language === "zh-CN" ? zhCN : enUS)
  // An empty field stays empty; today is only the initial navigation position.
  const selectedDate = "selected" in props
    ? props.selected instanceof Date ? props.selected : Array.isArray(props.selected) ? props.selected[0] : props.selected?.from
    : undefined
  const [internalMonth, setInternalMonth] = React.useState(() => defaultMonth ?? selectedDate ?? new Date())
  const month = controlledMonth ?? internalMonth
  const currentYear = new Date().getFullYear()
  const firstYear = startMonth?.getFullYear() ?? Math.min(currentYear - 100, month.getFullYear())
  const lastYear = endMonth?.getFullYear() ?? Math.max(currentYear + 10, month.getFullYear())
  const changeMonth = (next: Date) => {
    const bounded = startMonth && next < new Date(startMonth.getFullYear(), startMonth.getMonth(), 1) ? startMonth
      : endMonth && next > endMonth ? endMonth : next
    if (!controlledMonth) setInternalMonth(bounded)
    onMonthChange?.(bounded)
  }

  return (
    <div data-slot="multi-month-calendar" className="flex w-fit max-w-full flex-col gap-4">
      <div className="flex justify-center gap-2">
        <Select value={String(month.getFullYear())} disabled={props.disableNavigation} onValueChange={value => { if (value !== null) changeMonth(new Date(Number(value), month.getMonth(), 1)) }}>
          <SelectTrigger aria-label={language === "zh-CN" ? "选择年份" : "Choose year"} className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>{Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index).map(year => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(month.getMonth())} disabled={props.disableNavigation} onValueChange={value => { if (value !== null) changeMonth(new Date(month.getFullYear(), Number(value), 1)) }}>
          <SelectTrigger aria-label={language === "zh-CN" ? "选择月份" : "Choose month"} className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>{Array.from({ length: 12 }, (_, index) => <SelectItem key={index} value={String(index)} disabled={Boolean((startMonth && new Date(month.getFullYear(), index + 1, 0) < startMonth) || (endMonth && new Date(month.getFullYear(), index, 1) > endMonth))}>{new Date(2000, index, 1).toLocaleString(locale.code, { month: "long" })}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <DayPicker
        {...props}
        month={month}
        onMonthChange={changeMonth}
        startMonth={startMonth}
        endMonth={endMonth}
        locale={locale}
        numberOfMonths={numberOfMonths}
        showOutsideDays={showOutsideDays}
        className={cn("rounded-lg border border-border bg-background p-2 w-fit max-w-full [--cell-size:2.25rem]", className)}
        classNames={{
          months: "relative flex flex-col gap-6 sm:flex-row",
          month: "w-[252px]",
          nav: "absolute inset-x-0 top-0 flex justify-between pointer-events-none",
          button_previous: cn(buttonVariants({ variant: buttonVariant }), "pointer-events-auto size-7 p-0 disabled:opacity-30"),
          button_next: cn(buttonVariants({ variant: buttonVariant }), "pointer-events-auto size-7 p-0 disabled:opacity-30"),
          month_caption: "flex h-7 items-center justify-center px-8 text-sm font-medium mb-2",
          month_grid: "w-full border-collapse",
          weekday: "h-9 w-9 text-xs font-medium text-muted-foreground/80",
          day: "group relative size-9 p-0 text-center text-sm",
          day_button: "size-9",
          range_start: "range-start",
          range_end: "range-end",
          range_middle: "range-middle",
          outside: "text-muted-foreground/40",
          disabled: "text-muted-foreground/30",
          hidden: "invisible",
          ...classNames,
        }}
        components={{ Chevron: CalendarChevron, DayButton: CalendarDayButton, ...components }}
      />
      <p data-no-translate className="mt-2 text-center text-xs text-muted-foreground">{language === "zh-CN" ? "技术支持：" : "Powered by"} <a href="https://www.ruixen.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">ruixen.com</a></p>
    </div>
  )
}

function CalendarChevron({ className, orientation, ...props }: ChevronProps) {
  const Icon = orientation === "left" ? ChevronLeftIcon : orientation === "right" ? ChevronRightIcon : ChevronDownIcon
  return <Icon className={cn("size-4", className)} aria-hidden="true" {...props} />
}

function CalendarDayButton({ className, day, modifiers, locale, ...props }: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { if (modifiers.focused) ref.current?.focus() }, [modifiers.focused])
  return <button {...props} type="button" ref={ref} data-day={day.date.toLocaleDateString(locale?.code)} className={cn(
    "relative flex size-9 items-center justify-center rounded-md text-sm hover:bg-black/10 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-black dark:focus-visible:ring-white",
    modifiers.selected && !modifiers.range_middle && "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
    modifiers.range_middle && "rounded-none bg-neutral-200 text-black dark:bg-neutral-700 dark:text-white",
    modifiers.range_start && !modifiers.range_end && "rounded-r-none",
    modifiers.range_end && !modifiers.range_start && "rounded-l-none",
    modifiers.outside && !modifiers.selected && "text-muted-foreground/40",
    modifiers.disabled && "pointer-events-none text-muted-foreground/30 line-through",
    modifiers.today && "after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:size-[3px] after:-translate-x-1/2 after:rounded-full after:bg-current",
    className,
  )} />
}

const MultiMonthCalendar = Calendar
export { Calendar, MultiMonthCalendar, CalendarDayButton }
