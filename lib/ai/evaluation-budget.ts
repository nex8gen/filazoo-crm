import { existsSync, openSync, closeSync, writeFileSync, readFileSync, renameSync, fsyncSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { AiBudgetError, chargedAiBudget, quoteAiBudget, type BudgetRate } from "./budget.ts";

export const EVALUATION_LIMIT_MICROS = 4_750_000; // Keep $0.25 below the user's $5 ceiling.
export const EVALUATION_DURATION_MS = 24 * 60 * 60 * 1000;
type Ledger = { version: 1; startedAt: number; endsAt: number; limitMicros: number; chargedMicros: number; pending: Record<string, number>; calls: number; halted: boolean };
export function atomicEvaluationJson(path: string, value: unknown) {
  const temp = `${path}.tmp`;
  const fd = openSync(temp, "w");
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
/** Caller holds an exclusive process lock for the ledger's entire lifetime. */
export function evaluationBudget(path: string, now: () => number = Date.now) {
  const ledger: Ledger = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {
    version: 1, startedAt: now(), endsAt: now() + EVALUATION_DURATION_MS,
    limitMicros: EVALUATION_LIMIT_MICROS, chargedMicros: 0, pending: {}, calls: 0, halted: false,
  };
  if (ledger.version !== 1 || ledger.limitMicros !== EVALUATION_LIMIT_MICROS || !Number.isSafeInteger(ledger.startedAt) || ledger.endsAt !== ledger.startedAt + EVALUATION_DURATION_MS ||
    !Number.isSafeInteger(ledger.chargedMicros) || ledger.chargedMicros < 0 || !Number.isSafeInteger(ledger.calls) || ledger.calls < 0 || typeof ledger.halted !== "boolean" ||
    !ledger.pending || typeof ledger.pending !== "object" || Array.isArray(ledger.pending) || Object.values(ledger.pending).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("Evaluation ledger is invalid; refusing paid calls.");
  atomicEvaluationJson(path, ledger);
  const used = () => ledger.chargedMicros + Object.values(ledger.pending).reduce((sum, value) => sum + value, 0);
  return {
    snapshot: () => ({ ...structuredClone(ledger), usedMicros: used(), remainingMicros: Math.max(0, ledger.limitMicros - used()) }),
    /** A fixed conservative envelope for a separately bounded native-provider verification. */
    reserveExternal(micros: number) {
      if (!Number.isSafeInteger(micros) || micros < 1 || ledger.halted || now() >= ledger.endsAt || used() + micros > ledger.limitMicros) throw new AiBudgetError("Evaluation time or total cost limit reached.");
      const id = randomUUID(); ledger.pending[id] = micros; ledger.calls++;
      atomicEvaluationJson(path, ledger);
      return { id, settle(chargedMicros: number) {
        if (!Object.hasOwn(ledger.pending, id) || !Number.isSafeInteger(chargedMicros) || chargedMicros < 0 || chargedMicros > micros) throw new Error("Invalid external evaluation settlement.");
        ledger.chargedMicros += chargedMicros; delete ledger.pending[id]; atomicEvaluationJson(path, ledger);
      } };
    },
    fetch(rateFor: (model: string) => Promise<BudgetRate>, fetcher: typeof fetch = fetch): typeof fetch {
      return async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== "https://ai-gateway.vercel.sh" || url.pathname !== "/v1/responses" || init?.method !== "POST" || typeof init.body !== "string") throw new AiBudgetError("Evaluation provider request blocked.", 503);
        const body = JSON.parse(init.body) as Record<string, unknown>;
        // No provider-side tools, regional/provider pins, priority services or hidden fees.
        if ((Array.isArray(body.tools) && body.tools.some(tool => tool.type !== "function")) || body.providerOptions || body.provider || body.models) throw new AiBudgetError("Evaluation permits local function tools only.", 503);
        const rate = await rateFor(String(body.model));
        const quote = quoteAiBudget(body, rate);
        init.signal?.throwIfAborted();
        if (ledger.halted || now() >= ledger.endsAt || used() + quote.reservedMicros > ledger.limitMicros) throw new AiBudgetError("Evaluation time or total cost limit reached.");
        const id = randomUUID();
        ledger.pending[id] = quote.reservedMicros;
        ledger.calls++;
        // A crash or ambiguous connection retains the full outstanding reservation.
        atomicEvaluationJson(path, ledger);
        const response = await fetcher(input, { ...init, redirect: "error" });
        let charge: number;
        try { charge = chargedAiBudget(await response.clone().json().catch(() => ({})), rate, quote, response.status); }
        catch (error) { ledger.halted = true; atomicEvaluationJson(path, ledger); throw error; }
        ledger.chargedMicros += charge;
        delete ledger.pending[id];
        try { atomicEvaluationJson(path, ledger); }
        catch (error) { ledger.halted = true; throw error; }
        return response;
      };
    },
  };
}

type Price = { input?: string; output?: string; input_cache_write?: string; input_tiers?: Array<{ cost: string }>; output_tiers?: Array<{ cost: string }>; input_cache_write_tiers?: Array<{ cost: string }>; regional?: Record<string, Price> };
export function evaluationRate(item: { context_window: number; pricing: Price }): BudgetRate {
  const regions = [item.pricing, ...Object.values(item.pricing.regional ?? {})];
  const input = regions.flatMap(price => [price.input, price.input_cache_write, ...(price.input_tiers ?? []).map(tier => tier.cost), ...(price.input_cache_write_tiers ?? []).map(tier => tier.cost)]).filter(value => value !== undefined).map(Number);
  const output = regions.flatMap(price => [price.output, ...(price.output_tiers ?? []).map(tier => tier.cost)]).filter(value => value !== undefined).map(Number);
  if (!input.length || !output.length || [...input, ...output].some(value => !Number.isFinite(value) || value <= 0) || !Number.isSafeInteger(item.context_window) || item.context_window < 1) throw new AiBudgetError("Current model pricing is invalid.", 503);
  return { input: Math.max(...input), output: Math.max(...output), context: item.context_window, webSearch: 0 };
}
