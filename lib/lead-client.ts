import type { LeadResult, LeadSearch } from "./ai-leads.ts";
import { legacyQualification } from "./lead-prospecting.ts";

export async function leadApi<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method, cache: "no-store", signal,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({ error: "The server response could not be read. Refresh to check the saved search before retrying." }));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data as T;
}
export const leadStatus = (lead: LeadResult) => lead.feedback === "dismissed" ? "rejected" : legacyQualification(lead);
export const leadSearchActive = (search: LeadSearch) => search.status === "queued" || search.status === "running";
export function searchLabel(search: LeadSearch) {
  return search.criteria.searchName || [search.criteria.audience?.category || search.products.map(product => product.name).join(", "), search.criteria.city || search.criteria.country].filter(Boolean).join(" · ");
}
