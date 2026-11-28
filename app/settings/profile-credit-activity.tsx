"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { formatCredits } from "@/lib/billing/credits";
import { buildCreditActivity, creditActivityLevel, type CreditActivityDay, type CreditActivityMode } from "@/lib/profile-credit-activity";

const modes = [{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "cumulative", label: "Cumulative" }] as const;
const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });
const asDate = (date: string) => new Date(`${date}T00:00:00Z`);

export function ProfileCreditActivity({ days, startDate, endDate }: { days: CreditActivityDay[]; startDate: string; endDate: string }) {
  const [mode, setMode] = useState<CreditActivityMode>("daily");
  const [focused, setFocused] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const { cells, months, columns } = buildCreditActivity(days, startDate, endDate, mode);
  const maximum = Math.max(0, ...cells.map(cell => cell.usedMicros));
  const total = days.reduce((sum, day) => sum + day.usedMicros, 0);
  const active = cells[hovered ?? focused ?? -1];
  const tabIndex = focused == null ? cells.length - 1 : Math.min(focused, cells.length - 1);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const horizontal = mode === "weekly" ? 1 : 7;
    const steps: Record<string, number> = { ArrowLeft: -horizontal, ArrowRight: horizontal, ArrowUp: -1, ArrowDown: 1, Home: -cells.length, End: cells.length };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(cells.length - 1, index + steps[event.key]));
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[next]?.focus();
  }

  return <section className="profile-activity" aria-labelledby="profile-activity-title">
    <div className="profile-section-heading">
      <h3 id="profile-activity-title">Credit activity</h3>
      <div className="profile-activity-modes" role="group" aria-label="Activity view">{modes.map(option => <button type="button" key={option.id} aria-pressed={mode === option.id} onClick={() => { setMode(option.id); setFocused(null); setHovered(null); }}>{option.label}</button>)}</div>
    </div>
    <div className="profile-activity-scroll">
      <div className="profile-activity-calendar" style={{ "--activity-columns": columns } as CSSProperties}>
        <div className="profile-activity-grid" data-mode={mode} role="group" aria-label={mode === "weekly" ? "Weekly credit activity" : mode === "cumulative" ? "Cumulative credit activity" : "Daily credit activity"} onMouseLeave={() => setHovered(null)}>
          {cells.map((cell, index) => {
            const date = dateFormat.format(asDate(cell.date));
            const label = `${date}${cell.endDate !== cell.date ? ` – ${dateFormat.format(asDate(cell.endDate))}` : ""}: ${formatCredits(cell.usedMicros)} ${mode === "cumulative" ? "cumulative credits" : "credits used"}`;
            return <button type="button" key={cell.date} className="profile-activity-cell" style={{ gridColumn: cell.column, gridRow: mode === "weekly" ? "1 / 8" : cell.row }} data-level={creditActivityLevel(cell.usedMicros, maximum)} title={label} aria-label={label} tabIndex={index === tabIndex ? 0 : -1} onFocus={() => setFocused(index)} onBlur={() => setFocused(null)} onMouseEnter={() => setHovered(index)} onKeyDown={event => navigate(event, index)} />;
          })}
        </div>
        <div className="profile-activity-months" aria-hidden="true">{months.map(month => <span key={month.date} style={{ gridColumn: `${month.column} / span ${Math.min(3, columns - month.column + 1)}` }} data-no-translate>{monthFormat.format(asDate(month.date))}</span>)}</div>
      </div>
    </div>
    <div className="profile-activity-footer">
      <p>{active ? <><span data-no-translate>{formatCredits(active.usedMicros)}</span> <span>{mode === "cumulative" ? "cumulative credits" : "credits used"}</span><span aria-hidden="true"> · </span><span data-no-translate>{dateFormat.format(asDate(active.date))}{active.endDate !== active.date ? ` – ${dateFormat.format(asDate(active.endDate))}` : ""}</span></> : total > 0 ? <><span data-no-translate>{formatCredits(total)}</span> <span>credits used in the past 12 months</span></> : <span>No credit activity yet.</span>}</p>
      <div className="profile-activity-legend" aria-label="Darker squares mean more credits used"><span>Less</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} aria-hidden="true" />)}<span>More</span></div>
    </div>
    <p className="profile-activity-note">Your usage only · China time (UTC+8)</p>
  </section>;
}
