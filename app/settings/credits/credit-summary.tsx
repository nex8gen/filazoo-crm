import { CalendarDays, CircleAlert } from "lucide-react";
import { formatCredits, formatUsagePercent, usagePercent, type CreditBalance } from "@/lib/billing/credits";

export function CreditSummary({ credits }: { credits: CreditBalance }) {
  const used = usagePercent(credits.usedMicros, credits.includedMicros + credits.topupMicros) ?? 0;
  const available = credits.remainingMicros <= 0 ? 0 : Math.max(0, 100 - used);
  const reset = credits.resetsAt && Number.isFinite(Date.parse(credits.resetsAt)) ? new Date(credits.resetsAt).toLocaleDateString("en-GB", { timeZone: "Asia/Shanghai", day: "numeric", month: "short", year: "numeric" }) : null;
  const exhausted = credits.remainingMicros <= 0;
  return <section className="settings-form-row billing-credit-card" aria-labelledby="credit-balance-title">
    <div className="settings-row-heading"><h2 id="credit-balance-title">AI credits</h2><p>Shared across your workspace.</p></div>
    <div className="billing-credit-details">
    <div className="billing-balance"><strong data-no-translate>{formatCredits(credits.remainingMicros)}</strong><span>credits available</span></div>
    <div className="billing-credit-progress"><div role="progressbar" aria-label="AI credits available" aria-valuemin={0} aria-valuemax={100} aria-valuenow={available} className={`billing-meter${used >= 80 ? " billing-meter-warning" : ""}`}><span style={{ width: `${available}%` }} /></div><span className="billing-small"><span data-no-translate>{formatUsagePercent(available)}</span> remaining</span></div>
    <dl className="billing-credit-stats"><div><dt>Credits used</dt><dd data-no-translate>{formatCredits(credits.usedMicros)}</dd></div><div><dt>Monthly allowance</dt><dd data-no-translate>{formatCredits(credits.includedMicros)}</dd></div>{credits.topupMicros > 0 ? <div><dt>Additional credits</dt><dd data-no-translate>{formatCredits(credits.topupMicros)}</dd></div> : null}</dl>
    {reset ? <p className="billing-renewal"><CalendarDays aria-hidden="true" /><span>Renews on</span> <time dateTime={credits.resetsAt} data-no-translate>{reset}</time></p> : null}
    {used >= 80 ? <p role="status" className="billing-notice billing-notice-warning"><CircleAlert aria-hidden="true" />{exhausted ? "Your AI credits are used up. Add credits or wait for your monthly allowance to renew." : "Your AI credit balance is running low."}</p> : null}
    </div>
  </section>;
}
