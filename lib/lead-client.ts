import type { LeadResult, LeadSearch } from "./ai-leads.ts";
import { legacyQualification } from "./lead-prospecting.ts";
import { isLeadAllowanceError, type LeadAllowance } from "./lead-allowance.ts";

export class LeadApiError extends Error {
  allowance?: LeadAllowance;
  constructor(message: string, allowance?: LeadAllowance) { super(message); this.name="LeadApiError"; this.allowance=allowance; }
}

export async function leadApi<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method, cache: "no-store", signal,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({ error: "The server response could not be read. Refresh to check the saved search before retrying." }));
  if (!response.ok) throw new LeadApiError(data.error || "The request could not be completed.",data.code==="AI_ALLOWANCE_BLOCKED" ? data.allowance : undefined);
  return data as T;
}
export const leadStatus = (lead: LeadResult) => lead.feedback === "dismissed" ? "rejected" : legacyQualification(lead);
export const leadSearchActive = (search: LeadSearch) => search.status === "queued" || search.status === "running";
export function leadSearchFailureState(search: LeadSearch) {
  if(search.status==="cancelled")return {kind:"cancelled",title:"Search cancelled",description:"Research was stopped. No completed result list is available for this search."};
  if(search.status!=="failed")return null;
  if(isLeadAllowanceError(search.error))return {kind:"allowance",title:"Search blocked by AI allowance",description:"The CRM AI allowance could not cover this request. This is separate from your Vercel Gateway credits. Changing the product or location will not resolve this limit."};
  return {kind:"failed",title:"Search could not finish",description:search.error || "Research did not complete. Review the error and try again when the problem is resolved."};
}
export function searchLabel(search: LeadSearch) {
  return search.criteria.searchName || [search.criteria.audience?.category || search.products.map(product => product.name).join(", "), search.criteria.city || search.criteria.country].filter(Boolean).join(" · ");
}
