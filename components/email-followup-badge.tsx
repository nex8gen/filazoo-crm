import { Bell, Bot, CheckCircle2, CircleAlert, CircleMinus, CircleStop, Sparkles } from "lucide-react";
import type { AppLanguage } from "@/lib/app-language";
import type { FollowupActionRecord } from "@/lib/email-followup-filters";
import { emailFollowupBadge } from "@/lib/email-followup-badge";

const icons = { ai: Bot, reminder: Bell, nurture: Sparkles, completed: CheckCircle2, stopped: CircleStop, unset: CircleMinus, attention: CircleAlert };

export function EmailFollowupBadge({ actions, language }: { actions: FollowupActionRecord[]; language: AppLanguage }) {
  const badge = emailFollowupBadge(actions, language);
  const Icon = icons[badge.icon];
  return <span className="mail-followup-badge" data-tone={badge.tone} data-no-translate title={badge.title || badge.label} aria-label={[badge.label, badge.detail].filter(Boolean).join(" · ")}>
    <span className="mail-followup-label"><Icon aria-hidden="true" className="size-3.5 shrink-0" /><span>{badge.label}</span></span>
    {badge.detail ? <span className="mail-followup-detail">{badge.dueAt ? <time dateTime={badge.dueAt}>{badge.detail}</time> : badge.detail}</span> : null}
  </span>;
}
