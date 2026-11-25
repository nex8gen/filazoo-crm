import { AiBudgetError, budgetFailure, chargedAiBudget, quoteAiBudget, type AiBudgetSummary, type BudgetRate } from "./budget.ts";
export type AiBudgetStore = {
  reserve(userId: string, model: string, micros: number): Promise<{ allowed: boolean; reason?: string; reservationId?: string }>;
  settle(userId: string, id: string, micros: number): Promise<void>;
  read?(userId: string): Promise<AiBudgetSummary>;
};
const owners = new WeakMap<typeof fetch, string>();
export const budgetFetchOwner = (fetcher: typeof fetch) => owners.get(fetcher);
export function createBudgetedAiFetch(userId: string, store: AiBudgetStore, rateFor: (model: string) => Promise<BudgetRate>, fetcher: typeof fetch = fetch): typeof fetch {
  const guarded: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const native = url.pathname === "/v4/ai/language-model";
    if (url.origin !== "https://ai-gateway.vercel.sh" || !["/v1/responses", "/v1/chat/completions", "/v4/ai/language-model"].includes(url.pathname)) throw new AiBudgetError("This AI provider is not configured for workspace spending limits.", 503);
    if (!userId || !init?.body || typeof init.body !== "string") throw new AiBudgetError("AI usage could not be linked to an active workspace member.", 503);
    let body = JSON.parse(init.body) as Record<string, unknown>;
    if (native) {
      const headers = new Headers(init.headers);
      const tools = (Array.isArray(body.tools) ? body.tools : []) as Array<{ type?: string; id?: string }>;
      if (tools.some(tool => tool.type !== "provider" || !["google.google_search", "google.url_context"].includes(tool.id ?? ""))) throw new AiBudgetError("This AI tool is not configured for workspace spending limits.", 503);
      const search = tools.some(tool => tool.id === "google.google_search");
      body = { ...body, model: headers.get("ai-language-model-id"), max_output_tokens: body.maxOutputTokens,
        stream: headers.get("ai-language-model-streaming") === "true", tools: search ? [{ type: "web_search" }] : [], max_tool_calls: search ? 1 : undefined };
    }
    const rate = await rateFor(String(body.model ?? ""));
    // Search results and URL context are opaque provider inputs. Reserve the
    // full context and settle using SDK totals, which include reasoning tokens.
    const quote = quoteAiBudget(body, rate, native);
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
  owners.set(guarded, userId);
  return guarded;
}
