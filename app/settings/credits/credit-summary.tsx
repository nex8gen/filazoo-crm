import { Sparkles, CalendarDays, CircleAlert } from "lucide-react";
import { formatCredits, usagePercent, type CreditBalance } from "@/lib/billing/credits";

export function CreditSummary({ credits }: { credits: CreditBalance }) {
  const used = usagePercent(credits.usedMicros, credits.includedMicros + credits.topupMicros) ?? 0;
  const available = Math.max(0, 100 - used);
  const reset = credits.resetsAt && Number.isFinite(Date.parse(credits.resetsAt)) ? new Date(credits.resetsAt).toLocaleDateString("en-GB", { timeZone: "Asia/Shanghai", day: "numeric", month: "short", year: "numeric" }) : null;
  const exhausted = credits.remainingMicros <= 0;
  return <section className="billing-card billing-credit-card" aria-labelledby="credit-balance-title">
    <div className="billing-card-heading"><h2 id="credit-balance-title"><Sparkles aria-hidden="true" />AI credits</h2><span className="billing-small">Shared workspace balance</span></div>
    <div className="billing-balance"><strong data-no-translate>{formatCredits(credits.remainingMicros)}</strong><span>available credits</span></div>
    <div role="progressbar" aria-label="AI credits available" aria-valuemin={0} aria-valuemax={100} aria-valuenow={available} className={`billing-meter${used >= 80 ? " billing-meter-warning" : ""}`}><span style={{ width: `${available}%` }} /></div>
    <dl className="billing-credit-stats"><div><dt>Credits used</dt><dd data-no-translate>{formatCredits(credits.usedMicros)}</dd></div><div><dt>Monthly allowance</dt><dd data-no-translate>{formatCredits(credits.includedMicros)}</dd></div><div><dt>Additional credits</dt><dd data-no-translate>{formatCredits(credits.topupMicros)}</dd></div></dl>
    {reset ? <p className="billing-renewal"><CalendarDays aria-hidden="true" /><span>Monthly credits renew on</span> <time dateTime={credits.resetsAt} data-no-translate>{reset}</time></p> : null}
    {used >= 80 ? <p role="status" className="billing-notice billing-notice-warning"><CircleAlert aria-hidden="true" />{exhausted ? "Your AI credits are used up. Add credits or wait for your monthly allowance to renew." : "Your AI credit balance is running low."}</p> : null}
  </section>;
}
