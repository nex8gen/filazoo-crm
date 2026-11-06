import { AiBudgetError, budgetFailure, chargedAiBudget, quoteAiBudget, type AiBudgetSummary, type BudgetRate } from "./budget.ts";
export type AiBudgetStore = {
  reserve(userId: string, model: string, micros: number): Promise<{ allowed: boolean; reason?: string; reservationId?: string }>;
  settle(userId: string, id: string, micros: number): Promise<void>;
  read?(userId: string): Promise<AiBudgetSummary>;
};
export function createBudgetedAiFetch(userId: string, store: AiBudgetStore, rateFor: (model: string) => Promise<BudgetRate>, fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "ai-gateway.vercel.sh" || !["/v1/responses", "/v1/chat/completions"].includes(url.pathname)) throw new AiBudgetError("This AI provider is not configured for workspace spending limits.", 503);
    if (!userId || !init?.body || typeof init.body !== "string") throw new AiBudgetError("AI usage could not be linked to an active workspace member.", 503);
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const rate = await rateFor(String(body.model ?? ""));
    const quote = quoteAiBudget(body, rate);
    init.signal?.throwIfAborted();
    const reservation = await store.reserve(userId, String(body.model), quote.reservedMicros);
    if (!reservation.allowed) {
      // A rejected reservation may exceed a nonzero balance. Never describe
      // that as exhausted credit, and never retry a paid call to work around it.
      const limits = reservation.reason === "user_disabled" ? undefined : await store.read?.(userId).catch(() => undefined);
      throw budgetFailure(reservation.reason ?? "request", limits);
    }
    if (!reservation.reservationId) throw new AiBudgetError("Unable to reserve AI allowance. Please try again later.", 503);
    let charged = quote.reservedMicros;
    let started = false;
    try {
      init.signal?.throwIfAborted();
      started = true;
      const response = await fetcher(input, init);
      charged = chargedAiBudget(await response.clone().json().catch(() => ({})), rate, quote, response.status);
      return response;
    } finally {
      if (!started) charged = 0;
      // The reservation stays charged if settlement is temporarily unavailable.
      // A successful provider response must not be retried because logging failed.
      await store.settle(userId, reservation.reservationId, charged).catch(() => { console.error("AI budget settlement pending; reservation retained."); });
    }
  };
}
