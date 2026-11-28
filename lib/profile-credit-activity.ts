export type CreditActivityDay = { date: string; usedMicros: number };
export type CreditActivityMode = "daily" | "weekly" | "cumulative";
export type CreditActivityCell = { date: string; endDate: string; usedMicros: number; column: number; row: number };

const DAY = 86_400_000;
const CHINA_OFFSET = 8 * 60 * 60 * 1000;

export function creditActivityWindow(now: Date) {
  const local = new Date(now.getTime() + CHINA_OFFSET);
  const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  const activityStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 11, 1);
  return {
    monthStart: new Date(monthStart - CHINA_OFFSET).toISOString(),
    activityStart: new Date(activityStart - CHINA_OFFSET).toISOString(),
    startDate: new Date(activityStart).toISOString().slice(0, 10),
    endDate: local.toISOString().slice(0, 10),
  };
}

export function creditActivityDate(timestamp: string) {
  return new Date(Date.parse(timestamp) + CHINA_OFFSET).toISOString().slice(0, 10);
}

export function buildCreditActivity(days: CreditActivityDay[], startDate: string, endDate: string, mode: CreditActivityMode) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const offset = new Date(start).getUTCDay();
  const totals = new Map(days.map(day => [day.date, day.usedMicros]));
  const cells: CreditActivityCell[] = [];
  let cumulative = 0;
  for (let timestamp = start, index = offset; timestamp <= end; timestamp += DAY, index++) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const usedMicros = totals.get(date) ?? 0;
    const column = Math.floor(index / 7) + 1;
    cumulative += usedMicros;
    if (mode === "weekly") {
      const previous = cells.at(-1);
      if (previous?.column === column) {
        previous.usedMicros += usedMicros;
        previous.endDate = date;
      } else cells.push({ date, endDate: date, usedMicros, column, row: 1 });
    } else cells.push({ date, endDate: date, usedMicros: mode === "cumulative" ? cumulative : usedMicros, column, row: index % 7 + 1 });
  }
  const months: Array<{ date: string; column: number }> = [];
  let lastMonth = "";
  for (let timestamp = start; timestamp <= end; timestamp += DAY) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    if (date.slice(0, 7) === lastMonth) continue;
    lastMonth = date.slice(0, 7);
    months.push({ date, column: Math.floor(((timestamp - start) / DAY + offset) / 7) + 1 });
  }
  return { cells, months, columns: Math.floor(((end - start) / DAY + offset) / 7) + 1 };
}

export function creditActivityLevel(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil(value / max * 4)));
}
