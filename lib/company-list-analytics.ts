import type { Company } from "./types";

type AnalyticsCompany = Pick<Company, "addedAt" | "customerTags" | "outreachStatus" | "paidOrderCount">;

const dayMs = 86_400_000;
const activeTags = new Set(["New Inquiries", "Quotation Follow-up", "Active Negotiations", "Payment Follow-up"]);

function measures(companies: readonly AnalyticsCompany[]) {
  const paying = companies.filter(company => company.paidOrderCount > 0).length;
  return [
    companies.length,
    companies.filter(company => company.outreachStatus.startsWith("Email") || company.customerTags?.some(tag => tag.startsWith("Contacted") || tag === "Customer replied")).length,
    companies.filter(company => company.outreachStatus === "Email replied" || company.customerTags?.includes("Customer replied")).length,
    companies.filter(company => company.customerTags?.some(tag => activeTags.has(tag))).length,
    paying,
    companies.length ? paying / companies.length * 100 : 0,
  ];
}

/** Compare acquisition cohorts; current tags are not historical status events. */
export function companyListAnalytics(companies: readonly AnalyticsCompany[], days: number, asOf: string) {
  const end = Date.parse(asOf);
  const start = end - days * dayMs;
  const previousStart = start - days * dayMs;
  const current: AnalyticsCompany[][] = Array.from({ length: days }, () => []);
  const previous: AnalyticsCompany[][] = Array.from({ length: days }, () => []);
  for (const company of companies) {
    const added = Date.parse(company.addedAt ?? "");
    if (!Number.isFinite(added) || added < previousStart || added > end) continue;
    const buckets = added >= start ? current : previous;
    const periodStart = added >= start ? start : previousStart;
    buckets[Math.min(days - 1, Math.floor((added - periodStart) / dayMs))].push(company);
  }
  const totals = measures(current.flat());
  const previousTotals = measures(previous.flat());
  const daily = current.map(measures);
  const previousDaily = previous.map(measures);
  return [
    { label: "New companies", detail: "Companies added in this period." },
    { label: "Contacted", detail: "Companies added in this period that have been contacted." },
    { label: "Customer replies", detail: "Companies added in this period with a customer reply." },
    { label: "Active opportunities", detail: "Companies added in this period currently in inquiry, quotation, negotiation, or payment follow-up." },
    { label: "Paying customers", detail: "Companies added in this period with at least one paid order." },
    { label: "Conversion rate", detail: "Share of companies added in this period with a paid order." },
  ].map((metric, index) => ({
    ...metric,
    value: totals[index],
    percentage: index === 5,
    change: previousTotals[index] ? (totals[index] - previousTotals[index]) / previousTotals[index] * 100 : null,
    points: daily.map(values => values[index]),
    previousPoints: previousDaily.map(values => values[index]),
  }));
}
