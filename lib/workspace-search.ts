export const workspaceSearchKinds = ["company", "contact", "invoice", "order", "product", "task", "shipment"] as const;
export type WorkspaceSearchKind = typeof workspaceSearchKinds[number];
export type WorkspaceSearchResult = { id: string; kind: WorkspaceSearchKind; title: string; detail: string; href: string };
export type WorkspaceSearchResponse = { query: string; results: WorkspaceSearchResult[]; unavailable: WorkspaceSearchKind[] };
export const workspaceSearchLabels: Record<WorkspaceSearchKind, string> = {
  company: "Companies", contact: "Contacts", invoice: "Invoices", order: "Purchase orders", product: "Products", task: "Your tasks", shipment: "Shipment tracking",
};

export function normalizeWorkspaceSearch(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
export function validWorkspaceSearch(value: string) {
  return value.length >= 2 && value.length <= 120 && !/[\u0000-\u001f\u007f*]/.test(value);
}
/** Quoted PostgREST operands keep commas, parentheses and quotes inside the value.
 * Escape LIKE wildcards separately so customer input cannot broaden the search. */
export function workspaceSearchFilter(fields: readonly string[], query: string) {
  const operand = JSON.stringify(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  return fields.map(field => `${field}.ilike.${operand}`).join(",");
}
export function searchInvoiceNumber(query: string): number | null {
  const match = /^(?:INV[-\s]*|#)?0*(\d{1,12})$/i.exec(query);
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}
export function rankWorkspaceResults(results: WorkspaceSearchResult[], query: string): WorkspaceSearchResult[] {
  const text = query.toLocaleLowerCase();
  const score = (item: WorkspaceSearchResult) => item.title.toLocaleLowerCase() === text ? 0 : item.title.toLocaleLowerCase().startsWith(text) ? 1 : 2;
  const unique = new Map(results.map(item => [`${item.kind}:${item.id}`, item]));
  return workspaceSearchKinds.flatMap(kind => [...unique.values()].filter(item => item.kind === kind)
    .sort((a, b) => score(a) - score(b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, 6));
}
/** Localize application metadata while leaving company names and identifiers intact. */
export function workspaceSearchDetail(item: WorkspaceSearchResult, translate: (value: string) => string) {
  if (item.kind === "company" && item.detail === "Company profile") return translate(item.detail);
  if (item.kind !== "task") return item.detail;
  const labels: Record<string, string> = { open: "Task is open", done: "Completed", cancelled: "Cancelled" };
  return item.detail.replace(/(^| · )(open|done|cancelled)$/, (_match, separator: string, status: string) => separator + translate(labels[status]));
}
export function isWorkspaceSearchResponse(value: unknown): value is WorkspaceSearchResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as WorkspaceSearchResponse;
  return typeof response.query === "string" && Array.isArray(response.results) && response.results.length <= 42
    && Array.isArray(response.unavailable) && response.unavailable.every(kind => workspaceSearchKinds.includes(kind))
    && response.results.every(item => item && workspaceSearchKinds.includes(item.kind) && typeof item.id === "string" && typeof item.title === "string"
      && typeof item.detail === "string" && typeof item.href === "string" && item.href.startsWith("/") && !item.href.startsWith("//"));
}
