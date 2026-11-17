import type { JsonConfig } from "./flows.ts";

export const waitUnits = ["days", "hours", "minutes"] as const;
export const maxWaitAmount = 525600;
export type WaitEditorDraft = { amount: string; unit: string; specificTime: boolean; resumeAt: string; businessDays: boolean };

export function waitEditorDraft(config: JsonConfig): WaitEditorDraft {
  return { amount: String(config.amount ?? 1), unit: String(config.unit || "days"), specificTime: typeof config.resumeAt === "string" && config.resumeAt.length > 0, resumeAt: typeof config.resumeAt === "string" && config.resumeAt ? config.resumeAt : "09:00", businessDays: config.businessDays === true };
}

export function waitDraftChanged(config: JsonConfig, draft: WaitEditorDraft) {
  const original = waitEditorDraft(config);
  return draft.amount !== original.amount || draft.unit !== original.unit || draft.businessDays !== original.businessDays || draft.specificTime !== original.specificTime || (draft.specificTime && draft.resumeAt !== original.resumeAt);
}

export function applyWaitDraft(config: JsonConfig, draft: WaitEditorDraft): { ok: true; config: JsonConfig } | { ok: false; error: string } {
  const amount = Number(draft.amount);
  if (!draft.amount.trim() || !Number.isInteger(amount) || amount < 1 || amount > maxWaitAmount) return { ok: false, error: "Enter a whole number from 1 to 525,600." };
  if (!waitUnits.some(unit => unit === draft.unit)) return { ok: false, error: "Choose days, hours, or minutes." };
  if (draft.specificTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.resumeAt)) return { ok: false, error: "Choose a valid time of day." };
  return { ok: true, config: { ...config, amount, unit: draft.unit, businessDays: draft.businessDays, resumeAt: draft.specificTime ? draft.resumeAt : "" } };
}

export function waitSummary(config: JsonConfig) {
  const amount = Number(config.amount) || 1;
  const unit = String(config.unit || "days").replace(/s$/, "");
  const duration = `${amount} ${config.businessDays && unit === "day" ? "business " : ""}${unit}${amount === 1 ? "" : "s"}`;
  return `Wait ${duration}${config.businessDays && unit !== "day" ? " · skip weekends" : ""}${config.resumeAt ? ` · ${config.resumeAt} UTC` : ""}`;
}
