import { AiBudgetError } from "./budget.ts";
import { budgetFetchOwner } from "./budget-fetch.ts";

/** Preserve injected transports and usage tracking, but never skip the wallet. */
export async function workspaceAiFetch(userId: string | undefined, fetcher: typeof fetch): Promise<typeof fetch> {
  // Pure generators can use a synthetic transport without a workspace (tests/evaluations).
  if (!userId) {
    if (fetcher !== fetch) return fetcher;
    throw new AiBudgetError("AI usage could not be linked to an active workspace member.", 503);
  }
  const owner = budgetFetchOwner(fetcher);
  if (owner === userId) return fetcher;
  if (owner) throw new AiBudgetError("AI usage belongs to a different workspace member.", 503);
  const { budgetedAiFetch } = await import("./budget-server.ts");
  return budgetedAiFetch(userId, fetcher);
}
