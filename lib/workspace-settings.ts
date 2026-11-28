import { z } from "zod";

export const DEFAULT_WORKSPACE_TIMEZONE = "Asia/Shanghai";
export const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const defaultBusinessHours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
export const workspaceLogoMaxBytes = 2 * 1024 * 1024;

export function isTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
export const timeZoneSchema = z.string().trim().min(1).max(100).refine(isTimeZone, "Choose a valid timezone.");
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a valid time.");
export const businessHoursSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1, "Choose at least one working day.").max(7).transform(days => [...new Set(days)].sort()),
  start: time,
  end: time,
}).refine(hours => hours.start < hours.end, { message: "Closing time must be after opening time on the same day.", path: ["end"] });
export const workspaceWebsiteSchema = z.string().trim().max(500).transform(value => value && !/^[a-z][a-z\d+.-]*:/i.test(value) ? `https://${value}` : value)
  .refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && url.hostname.includes("."); } catch { return false; }
  }, "Enter a valid company website using http or https.");

export type BusinessHours = z.infer<typeof businessHoursSchema>;
export type WorkspaceSettings = { website: string; logoDataUrl: string | null; timezone: string; businessHours: BusinessHours };
export type WorkspaceSchedule = Pick<WorkspaceSettings, "timezone" | "businessHours">;
export const defaultWorkspaceSettings: WorkspaceSettings = { website: "", logoDataUrl: null, timezone: DEFAULT_WORKSPACE_TIMEZONE, businessHours: defaultBusinessHours };

/** Returns null while open. Check actual instants so DST gaps and repeated hours
 * follow the timezone database, without relying on the server's local timezone. */
export function nextWorkspaceBusinessWindow(now: Date, timezone: string, hours: BusinessHours): Date | null {
  timeZoneSchema.parse(timezone);
  businessHoursSchema.parse(hours);
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid schedule date.");
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const isOpen = (date: Date) => {
    const parts = formatter.formatToParts(date);
    const value = (type: string) => parts.find(part => part.type === type)!.value;
    const clock = `${value("hour")}:${value("minute")}`;
    return hours.days.includes(weekdays.indexOf(value("weekday"))) && clock >= hours.start && clock < hours.end;
  };
  if (isOpen(now)) return null;
  const wallTimestamp = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: string) => Number(parts.find(part => part.type === type)!.value);
    return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  };
  const localDay = new Date(wallTimestamp(now.getTime()));
  localDay.setUTCHours(0, 0, 0, 0);
  const clockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  for (let day = 0; day <= 8; day++) {
    const dayStart = localDay.getTime() + day * 86_400_000;
    if (!hours.days.includes(new Date(dayStart).getUTCDay())) continue;
    const opening = dayStart + clockMinutes(hours.start) * 60_000;
    // Sample both sides of a possible offset transition. Mapping a wall-clock
    // minute back to itself rejects nonexistent times and handles repeated times.
    const offsets = [...new Set([-1, 0, 1].map(delta => {
      const sample = opening + delta * 86_400_000;
      return wallTimestamp(sample) - sample;
    }))];
    for (let minute = clockMinutes(hours.start); minute < clockMinutes(hours.end); minute++) {
      const wall = dayStart + minute * 60_000;
      const candidates = offsets.map(offset => wall - offset).filter(instant => instant >= now.getTime() && wallTimestamp(instant) === wall).sort((a, b) => a - b);
      if (candidates.length) return new Date(candidates[0]);
      // Opening already passed on this day. Only a repeated hour could reopen it.
      if (offsets.length === 1 && wall - offsets[0] < now.getTime()) break;
    }
  }
  throw new Error("Unable to resolve the next business hours.");
}
