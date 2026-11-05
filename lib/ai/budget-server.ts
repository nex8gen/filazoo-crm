import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { AiBudgetError, BUDGET_MODELS, type AiBudgetSummary, type BudgetRate } from "./budget.ts";
import { createBudgetedAiFetch, type AiBudgetStore } from "./budget-fetch.ts";

let rates: { expires: number; values: Map<string, BudgetRate> } | undefined;

function budgetStoreError(operation: string, error: { code?: string; message?: string }, model?: string) {
  // Log identifiers only: database details can contain private request data.
  console.error("AI allowance check failed", { operation, code: error.code, ...(model ? { model } : {}) });
  if (error.code === "P0001" && error.message === "Invalid AI reservation") {
    return new AiBudgetError("The app's AI model configuration is out of date. Ask an administrator to rebuild and restart the CRM with the current AI settings.", 503);
  }
  if (["PGRST202", "42883", "42P01"].includes(error.code ?? "")) {
    return new AiBudgetError("AI allowance setup is incomplete. Ask an administrator to apply the workspace AI budget migrations.", 503);
  }
  return new AiBudgetError("Unable to verify AI allowance. Please try again later.", 503);
}
export async function readBudgetRate(model: string): Promise<BudgetRate> {
  if (!(BUDGET_MODELS as readonly string[]).includes(model)) throw new AiBudgetError("This AI model is not configured for workspace spending limits.", 503);
  if (!rates || rates.expires <= Date.now()) {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", { signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!response.ok) throw new AiBudgetError("Unable to verify AI prices. Please try again later.", 503);
    const catalog = await response.json() as { data: Array<{ id: string; context_window: number; pricing: { input: string; output: string; input_cache_write?: string; input_cache_write_tiers?: Array<{ cost: string; min: number }>; web_search?: string; input_tiers?: Array<{ cost: string; min: number }>; output_tiers?: Array<{ cost: string; min: number }> } }> };
    const values = new Map<string, BudgetRate>();
    for (const item of catalog.data ?? []) {
      if (!(BUDGET_MODELS as readonly string[]).includes(item.id)) continue;
      const rate: BudgetRate = { input: Math.max(Number(item.pricing.input), Number(item.pricing.input_cache_write ?? item.pricing.input)), output: Number(item.pricing.output), context: item.context_window, webSearch: Number(item.pricing.web_search ?? 10) / 1000,
        tiers: (item.pricing.input_tiers ?? []).map(tier => ({ min: tier.min, input: Math.max(Number(tier.cost), Number(item.pricing.input_cache_write_tiers?.find(cache => cache.min === tier.min)?.cost ?? tier.cost)), output: Number(item.pricing.output_tiers?.find(output => output.min === tier.min)?.cost ?? item.pricing.output) })) };
      if (!Number.isFinite(rate.input) || rate.input <= 0 || !Number.isFinite(rate.output) || rate.output <= 0 || !Number.isSafeInteger(rate.context) || rate.context < 1 || !Number.isFinite(rate.webSearch) || rate.webSearch < 0) throw new AiBudgetError("Unable to verify AI prices. Please try again later.", 503);
      if (rate.tiers?.some(tier => !Number.isSafeInteger(tier.min) || tier.min < 0 || !Number.isFinite(tier.input) || tier.input <= 0 || !Number.isFinite(tier.output) || tier.output <= 0)) throw new AiBudgetError("Unable to verify AI prices. Please try again later.", 503);
      values.set(item.id, rate);
    }
    rates = { expires: Date.now() + 60000, values };
  }
  const rate = rates.values.get(model);
  if (!rate) throw new AiBudgetError("This AI model is not configured for workspace spending limits.", 503);
  return rate;
}
export function budgetedAiFetch(userId: string, fetcher: typeof fetch = fetch) {
  const store: AiBudgetStore = {
    async reserve(owner, model, micros) {
      const { data, error } = await createSupabaseAdmin().rpc("reserve_ai_budget", { p_user_id: owner, p_model: model, p_micros: micros });
      if (error) throw budgetStoreError("reserve", error, model);
      return data as { allowed: boolean; reason?: string; reservationId?: string };
    },
    async settle(owner, id, micros) {
      const { error } = await createSupabaseAdmin().rpc("settle_ai_budget", { p_user_id: owner, p_id: id, p_micros: micros });
      if (error) throw new Error("AI budget settlement unavailable");
    },
  };
  return createBudgetedAiFetch(userId, store, readBudgetRate, fetcher);
}
export async function readAiBudget(userId: string): Promise<AiBudgetSummary> {
  const { data, error } = await createSupabaseAdmin().rpc("read_ai_budget", { p_user_id: userId });
  if (error) throw budgetStoreError("read", error);
  if (!data) throw new AiBudgetError("Unable to load AI allowance. Please try again later.", 503);
  return data as AiBudgetSummary;
}
