"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DateRange } from "react-day-picker";
import { enUS, zhCN } from "react-day-picker/locale";
import { useLanguage } from "@/components/language-provider";
import { CalendarDayButton } from "@/components/ui/calendar";

export function HomeDateCalendar({ today, selected, onSelect }: { today: Date; selected?: DateRange; onSelect: (range: DateRange | undefined) => void }) {
  const { language } = useLanguage();
  const anchor = selected?.to ?? selected?.from ?? today;
  return <DayPicker mode="range" selected={selected} onSelect={onSelect} today={today} locale={language === "zh-CN" ? zhCN : enUS}
    defaultMonth={new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)} numberOfMonths={2} endMonth={today} startMonth={new Date(1900, 0, 1)} disabled={{ after: today }} showOutsideDays={false}
    className="home-date-calendar" classNames={{
      months: "home-calendar-months relative flex gap-4", month: "home-calendar-month min-w-0 shrink-0", nav: "absolute inset-x-0 top-0 flex justify-between pointer-events-none",
      button_previous: "pointer-events-auto grid size-7 place-items-center rounded-md hover:bg-muted disabled:opacity-30", button_next: "pointer-events-auto grid size-7 place-items-center rounded-md hover:bg-muted disabled:opacity-30",
      month_caption: "mb-2 flex h-7 items-center justify-center px-7 text-xs font-medium", month_grid: "w-full border-collapse", weekday: "h-7 text-[10px] font-normal text-muted-foreground",
      day: "relative h-[30px] p-0 text-center text-xs", day_button: "home-calendar-day", range_start: "range-start", range_end: "range-end", range_middle: "range-middle", disabled: "text-muted-foreground/30", hidden: "invisible",
    }} components={{ DayButton: CalendarDayButton, Chevron: ({ orientation }) => orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" /> }} />;
}
