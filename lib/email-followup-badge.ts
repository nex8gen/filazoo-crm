import type { AppLanguage } from "./app-language.ts";
import { followupActionState, type FollowupActionRecord } from "./email-followup-filters.ts";

type BadgeIcon = "ai" | "reminder" | "nurture" | "completed" | "stopped" | "unset" | "attention";
export type FollowupBadge = {
  label: string; detail?: string; title?: string; dueAt?: string;
  tone: "blue" | "orange" | "violet" | "green" | "muted" | "red";
  icon: BadgeIcon;
};

function scheduleLabel(value: string, language: AppLanguage, now: Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const zh = language === "zh-CN";
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const day = date.toDateString() === now.toDateString() ? zh ? "今天" : "Today"
    : date.toDateString() === tomorrow.toDateString() ? zh ? "明天" : "Tomorrow"
      : date.toLocaleDateString(language, { month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  const time = date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}${zh ? " " : ", "}${time}`;
}

/** Badges use the same saved action and completion rules as the follow-up tabs. */
export function emailFollowupBadge(records: FollowupActionRecord[], language: AppLanguage, now = new Date()): FollowupBadge {
  const actions = records.filter(action => action.source === "followup").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const action = actions.find(action => followupActionState(action) !== "completed") || actions[0];
  const zh = language === "zh-CN";
  if (!action) return { label: zh ? "未设置" : "Not set", tone: "muted", icon: "unset" };
  if (followupActionState(action) === "completed") {
    if (action.status === "cancelled" || action.taskStatus === "cancelled") return { label: zh ? "已停止" : "Stopped", tone: "muted", icon: "stopped" };
    return { label: action.status === "sent" ? zh ? "跟进已发送" : "Follow-up sent" : zh ? "跟进已完成" : "Completed", tone: "green", icon: "completed" };
  }
  if (["failed", "uncertain", "needs_review", "waiting_shipping"].includes(action.status)) {
    return { label: zh ? "需要处理" : "Needs attention", detail: action.status === "uncertain" ? zh ? "请核查已发送邮件" : "Check Sent" : zh ? "请检查跟进设置" : "Review follow-up", tone: "red", icon: "attention" };
  }
  if (action.status === "processing") return { label: zh ? "正在发送跟进" : "Sending follow-up", tone: "blue", icon: "ai" };
  const badge: FollowupBadge = action.kind === "reminder"
    ? { label: action.status === "reminded" ? zh ? "提醒已到期" : "Reminder due" : zh ? "等待手动跟进" : "Manual follow-up", tone: "orange", icon: "reminder" }
    : action.purpose === "nurture"
      ? { label: zh ? "沉睡客户 AI 培育" : "AI nurture", tone: "violet", icon: "nurture" }
      : { label: zh ? "AI 跟进中" : "AI following up", tone: "blue", icon: "ai" };
  const schedule = action.dueAt && scheduleLabel(action.dueAt, language, now);
  if (schedule) {
    badge.dueAt = action.dueAt;
    badge.detail = schedule;
    const mode = action.kind === "reminder" ? zh ? "提醒时间" : "Reminder" : zh ? "自动发送时间" : "Auto-send";
    badge.title = `${badge.label} · ${mode}: ${new Date(action.dueAt!).toLocaleString(language)}`;
  }
  return badge;
}
