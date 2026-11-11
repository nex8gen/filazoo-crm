import "server-only";
import { readAiBudget, readBudgetRate } from "./budget-server.ts";
import { quoteAiBudget } from "./budget.ts";
import { leadAllowance } from "../lead-allowance.ts";

/** A read-only preflight. Per-call atomic reservations remain authoritative. */
export async function readLeadAllowance(userId: string, request?: Record<string, unknown>) {
  const [summary, required] = await Promise.all([
    readAiBudget(userId),
    request ? readBudgetRate(String(request.model)).then(rate=>quoteAiBudget(request,rate).reservedMicros) : Promise.resolve(undefined),
  ]);
  return leadAllowance(summary,required);
}
