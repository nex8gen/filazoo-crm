import { richResponseInstruction } from "./response-markdown.ts";

export type SalesReviewRange = { since: string; until: string; label: string; timezone: "Asia/Shanghai" };
/** A narrow read-only report intent. It never changes the requested mode or permissions. */
export function salesReviewRange(text: string, now = new Date()): SalesReviewRange | null {
  if (!/(?:sales\s+(?:activity|review|performance)|销售(?:活动|回顾|业绩))/i.test(text)) return null;
  const broad = /\b(?:accessible|our|my|workspace|team)\s+sales\b|\b(?:review|summari[sz]e|show|explain)\s+(?:the\s+)?(?:last|past|this|today|weekly)\b[\s\S]{0,100}\bsales\b|(?:本周|今天|今日|过去七天|最近七天|最近7天).*销售/i.test(text);
  if (!broad) return null;
  if (/\b(?:this|that|selected|current)\s+(?:customer|company|account|client)\b|\b(?:for|about)\s+(?:(?:our|my|the)\s+)?(?:customer|company|account|client)\b/i.test(text)) return null;
  if (/\b(?:send|save|create|update|delete|issue|record|activate|schedule|assign|draft|prepare|export|convert|mark|pause|cancel)\b|发送|保存|创建|删除|开票|启用/i.test(text)) return null;
  if (/\b(?:for|of)\s+(?:customer|company|account|client)\s+(?!activity\b|work\b|our\b|my\b|the\b)[\p{L}\p{N}]/iu.test(text)) return null;
  if (/\b(?:for|about)\s+(?!(?:our|my|the|this|next|last|all|accessible|workspace|team)\b)[\p{L}\p{N}]/iu.test(text)) return null;
  const until = now.toISOString();
  const local = new Date(now.getTime() + 8 * 3600000);
  let since: Date, label: string;
  if (/\b(?:last|past)\s+(?:seven|7)\s+days\b|过去七天|最近七天|最近7天/i.test(text)) {
    since = new Date(now.getTime() - 7 * 86400000); label = "Last seven days";
  } else if (/\b(?:this week|weekly sales review)\b|本周/i.test(text)) {
    const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 3600000;
    since = new Date(midnight - ((local.getUTCDay() + 6) % 7) * 86400000); label = "This week";
  } else if (/\btoday\b|今天|今日/i.test(text)) {
    since = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 3600000); label = "Today";
  } else return null;
  return { since: since.toISOString(), until, label, timezone: "Asia/Shanghai" };
}

export const salesReviewInstruction = `${richResponseInstruction}
SALES ACTIVITY REVIEW: Answer the actual read-only sales review request using only SALES_REVIEW evidence. The report scope is the caller's accessible customers, independent of the open email or page. Do not infer a full mailbox review or read more records through textual tool markers. Give a concise period summary, what moved forward, what is stalled and exactly the requested number of useful improvements if supported. Link supporting CRM records. Separate dated audit events and document creation from current document status: an updated/created draft is not a completed sale; an invoice's current paid balance does not prove money arrived in this period. Quote amounts are not revenue. Keep currencies separate. Unavailable sources are unknown, never zero. Counts are returned-row counts unless a complete source says otherwise. Distinguish current overdue work from historical progress. Put one short coverage note at the end stating date window, truncated/unavailable sources and that external mailbox history was not scanned. Recommend actions, never claim to have saved/sent anything or output action/read protocols. Use the requested language.`;
