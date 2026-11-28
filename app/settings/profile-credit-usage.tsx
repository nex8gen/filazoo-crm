import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { requireWorkspaceMember } from "@/lib/auth";
import { readAiBudget } from "@/lib/ai/budget-server";
import { formatCredits, formatUsagePercent, usagePercent } from "@/lib/billing/credits";
import { readPersonalCreditUsage } from "@/lib/data/profile-credit-usage";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { RefreshUsage } from "./credits/refresh-usage";
import { ProfileCreditActivity } from "./profile-credit-activity";

export async function ProfileCreditUsage() {
  const viewer = await requireWorkspaceMember();
  const [personal, budget] = await Promise.all([
    readPersonalCreditUsage().catch(() => null),
    withWorkspaceViewer(viewer, () => readAiBudget(viewer.id)).catch(() => null),
  ]);
  const credits = budget?.credits;
  const usedPercent = credits ? usagePercent(credits.usedMicros, credits.includedMicros + credits.topupMicros) ?? 0 : 0;
  const reset = credits?.resetsAt && Number.isFinite(Date.parse(credits.resetsAt))
    ? new Date(credits.resetsAt).toLocaleDateString("en-GB", { timeZone: "Asia/Shanghai", day: "numeric", month: "short" }) : null;

  return <><section className="profile-credits" aria-labelledby="profile-credits-title">
    <div className="profile-section-heading"><h3 id="profile-credits-title">AI credits</h3><Link href="/settings/credits">View usage<ArrowUpRight aria-hidden="true" /></Link></div>
    <dl className="profile-credit-stats">
      <div><dt>Your credits used</dt><dd data-no-translate>{personal ? formatCredits(personal.usedMicros) : "—"}</dd><span>This calendar month</span></div>
      <div><dt>Workspace credits left</dt><dd data-no-translate>{credits ? formatCredits(credits.remainingMicros) : "—"}</dd><span>Shared with your team</span></div>
      <div><dt>Monthly credits</dt><dd data-no-translate>{credits ? formatCredits(credits.includedMicros) : "—"}</dd><span>Workspace allowance</span></div>
    </dl>
    {credits ? <div className="profile-credit-balance">
      <div className="profile-credit-caption"><span><span data-no-translate>{formatCredits(credits.usedMicros)}</span> workspace credits used</span><span><span data-no-translate>{formatUsagePercent(usedPercent)}</span> used</span></div>
      <div className="profile-credit-meter" role="progressbar" aria-label="Workspace credits used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent}><span data-warning={usedPercent >= 80 || undefined} style={{ width: `${usedPercent}%` }} /></div>
      {reset ? <p><span>Monthly credits renew on</span> <time dateTime={credits.resetsAt} data-no-translate>{reset}</time></p> : null}
      {credits.remainingMicros <= 0 ? <p role="status">AI credits are used up.</p> : null}
      {budget.enabled === false ? <p role="status">AI is paused for your account.</p> : null}
    </div> : null}
    {personal && personal.pendingMicros > 0 ? <p className="profile-credit-note"><span data-no-translate>{formatCredits(personal.pendingMicros)}</span> <span>credits reserved for unfinished requests, excluded from your used total.</span></p> : null}
    {!personal || !credits ? <div role="status" className="profile-credit-unavailable"><p>Some credit usage is unavailable. Try refreshing.</p><RefreshUsage /></div> : null}
  </section>
    {personal ? <ProfileCreditActivity key={`${viewer.workspaceId}:${viewer.id}`} days={personal.activity} startDate={personal.startDate} endDate={personal.endDate} /> : null}
  </>;
}
