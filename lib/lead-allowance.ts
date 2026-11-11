import type { AiBudgetSummary } from "./ai/budget.ts";

export type LeadAllowance = {
  availableMicros: number; requiredMicros?: number; resetsAt: string;
  scope: "daily" | "workspaceDaily" | "monthly"; enabled: boolean;
};
export function leadAllowance(summary: AiBudgetSummary, requiredMicros?: number): LeadAllowance {
  const scopes = ["daily", "workspaceDaily", "monthly"] as const;
  const limited = [...scopes].sort((a,b)=>summary[a].remainingMicros-summary[b].remainingMicros)[0];
  // If several periods block this request, the earliest possible retry is
  // after all of their resets, not merely the next daily reset.
  const blocking = requiredMicros === undefined ? [] : scopes.filter(scope=>summary[scope].remainingMicros<requiredMicros);
  const scope = blocking.sort((a,b)=>Date.parse(summary[b].resetsAt)-Date.parse(summary[a].resetsAt))[0] ?? limited;
  return {availableMicros:summary[limited].remainingMicros,requiredMicros,resetsAt:summary[scope].resetsAt,scope,enabled:summary.enabled!==false&&summary.daily.limitMicros>0&&summary.workspaceDaily.limitMicros>0&&summary.monthly.limitMicros>0};
}
export const leadAllowanceBlocked = (allowance: LeadAllowance) => !allowance.enabled || allowance.requiredMicros!==undefined&&allowance.availableMicros<allowance.requiredMicros;
export const leadUsd = (micros: number) => "$" + (micros / 1_000_000).toFixed(4);
export const leadResetTime = (value: string) => new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Shanghai",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value));
export const isLeadAllowanceError = (message: string | null) => /AI (?:allowance|spending)|daily AI allowance|monthly AI budget|workspace.*AI allowance/i.test(message ?? "");
