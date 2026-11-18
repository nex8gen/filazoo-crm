import type { JsonConfig } from "./flows.ts";

export const waitUnits = ["days", "hours", "minutes", "months"] as const;
export const maxWaitAmount = 525600;
export type WaitEditorDraft = { amount: string; unit: string; specificTime: boolean; resumeAt: string; businessDays: boolean; anchor?: string };

export function waitEditorDraft(config: JsonConfig): WaitEditorDraft {
  return { amount: String(config.amount ?? 1), unit: String(config.unit || "days"), specificTime: typeof config.resumeAt === "string" && config.resumeAt.length > 0, resumeAt: typeof config.resumeAt === "string" && config.resumeAt ? config.resumeAt : "09:00", businessDays: config.businessDays === true, ...(config.anchor ? { anchor: String(config.anchor) } : {}) };
}

export function waitDraftChanged(config: JsonConfig, draft: WaitEditorDraft) {
  const original = waitEditorDraft(config);
  return draft.amount !== original.amount || draft.unit !== original.unit || draft.businessDays !== original.businessDays || draft.anchor !== original.anchor || draft.specificTime !== original.specificTime || (draft.specificTime && draft.resumeAt !== original.resumeAt);
}

export function applyWaitDraft(config: JsonConfig, draft: WaitEditorDraft): { ok: true; config: JsonConfig } | { ok: false; error: string } {
  const amount = Number(draft.amount);
  if (!draft.amount.trim() || !Number.isInteger(amount) || amount < 1 || amount > maxWaitAmount) return { ok: false, error: "Enter a whole number from 1 to 525,600." };
  if (!waitUnits.some(unit => unit === draft.unit)) return { ok: false, error: "Choose months, days, hours, or minutes." };
  if (draft.unit === "months" && amount > 24) return { ok: false, error: "Choose a delay of 24 months or less." };
  if (draft.specificTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.resumeAt)) return { ok: false, error: "Choose a valid time of day." };
  return { ok: true, config: { ...config, amount, unit: draft.unit, businessDays: draft.businessDays, resumeAt: draft.specificTime ? draft.resumeAt : "", ...(draft.anchor ? { anchor: draft.anchor } : {}) } };
}

export function waitSummary(config: JsonConfig) {
  const amount = Number(config.amount) || 1;
  const unit = String(config.unit || "days").replace(/s$/, "");
  const duration = `${amount} ${config.businessDays && unit === "day" ? "business " : ""}${unit}${amount === 1 ? "" : "s"}`;
  return `Wait ${duration}${config.anchor === "trigger" ? " from trigger" : ""}${config.businessDays && unit !== "day" ? " · skip weekends" : ""}${config.resumeAt ? ` · ${config.resumeAt} UTC` : ""}`;
}
