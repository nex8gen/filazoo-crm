export type ActivityAction = "review" | "email" | "call" | "invoice" | "shipping" | "schedule" | "complete" | "task" | "notification";

export function activityAction(text: string, fallback: ActivityAction): ActivityAction {
  if (/\b(completed|cancelled)\b/i.test(text)) return "complete";
  if (/\b(review|approval|approve)\b|审核|审批/i.test(text)) return "review";
  if (/\b(invoice|payment|quote|quotation)\b|发票|付款|报价/i.test(text)) return "invoice";
  if (/\b(shipping|shipment|delivery|dispatch)\b|发货|运费/i.test(text)) return "shipping";
  if (/\b(call|phone)\b|电话/i.test(text)) return "call";
  if (/\b(email|e-mail|reply|replies|mail)\b|邮件|回复/i.test(text)) return "email";
  if (/\b(schedule|meeting|reminder|due|follow.up)\b|跟进|提醒/i.test(text)) return "schedule";
  return fallback;
}

export function activityRelativeTime(value: string, now: Date) {
  const delta = Date.parse(value) - now.getTime();
  if (!Number.isFinite(delta)) return "";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const minutes = Math.abs(delta) / 60_000;
  if (minutes < 1) return "Just now";
  if (minutes < 60) return format.format(Math.round(delta / 60_000), "minute");
  if (minutes < 1440) return format.format(Math.round(delta / 3_600_000), "hour");
  return format.format(Math.round(delta / 86_400_000), "day");
}
