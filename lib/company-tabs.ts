export const companyTabs = ["profile", "email", "purchase-orders", "analyse", "invoices", "customer-portal", "history"] as const;
export type CompanyTab = typeof companyTabs[number];

export function companyTab(value: unknown): CompanyTab {
  return typeof value === "string" && companyTabs.some(tab => tab === value) ? value as CompanyTab : "profile";
}

export function companyTabHref(companyId: string, search: string, tab: CompanyTab) {
  const params = new URLSearchParams(search);
  if (tab === "profile") params.delete("tab"); else params.set("tab", tab);
  if (tab !== "email") params.delete("compose");
  const query = params.toString();
  return `/companies/${encodeURIComponent(companyId)}${query ? `?${query}` : ""}`;
}
