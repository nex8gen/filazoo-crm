import { z } from "zod";
import type { Company, DataMode } from "./types.ts";
import type { companyListAnalytics } from "./company-list-analytics.ts";

export const companyListRequestSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).catch(1),
  pageSize: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]).catch(25),
  query: z.string().max(300).catch(""),
  country: z.string().max(100).catch("all"),
  tag: z.string().max(100).catch("all"),
  sort: z.enum(["name", "email", "ownerName", "addedAt", "country", "segment", "createdAt"]).catch("createdAt"),
  descending: z.boolean().catch(true),
  segment: z.string().max(120).optional(),
  segmentId: z.uuid().optional(),
});
export type CompanyListRequest = z.infer<typeof companyListRequestSchema>;
export type CompanyAnalyticsBucket = { day: number; counts: number[] };
export type CompanyListPage = {
  mode: DataMode; companies: Company[]; total: number; page: number;
  countries: string[]; segments: string[]; buckets: CompanyAnalyticsBucket[];
};

/** Only URLs within the company register are constructed here. */
export function companyListHref(search: string, changes: Record<string, string | number | undefined>) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === "" || value === "all") params.delete(key);
    else params.set(key, String(value));
  }
  return `/companies${params.size ? `?${params}` : ""}`;
}

/** The database sends daily counts, never every customer's analytics record. */
export function companyListBucketAnalytics(buckets: CompanyAnalyticsBucket[], days: number): ReturnType<typeof companyListAnalytics> {
  const daily = Array.from({ length: 180 }, () => [0, 0, 0, 0, 0]);
  for (const bucket of buckets) if (bucket.day >= 0 && bucket.day < 180) daily[bucket.day] = bucket.counts;
  const current = daily.slice(180 - days);
  const previous = daily.slice(180 - days * 2, 180 - days);
  const totals = (rows: number[][]) => rows.reduce((sum, row) => sum.map((value, i) => value + row[i]), [0, 0, 0, 0, 0]);
  const measures = (counts: number[]) => [...counts, counts[0] ? counts[4] / counts[0] * 100 : 0];
  const values = measures(totals(current)), previousValues = measures(totals(previous));
  const labels = ["New companies", "Contacted", "Customer replies", "Active opportunities", "Paying customers", "Conversion rate"];
  const details = ["Companies added in this period.", "Companies added in this period that have been contacted.", "Companies added in this period with a customer reply.", "Companies added in this period currently in inquiry, quotation, negotiation, or payment follow-up.", "Companies added in this period with at least one paid order.", "Share of companies added in this period with a paid order."];
  return labels.map((label, i) => ({ label, detail: details[i], value: values[i], percentage: i === 5,
    change: previousValues[i] ? (values[i] - previousValues[i]) / previousValues[i] * 100 : null,
    points: current.map(row => measures(row)[i]), previousPoints: previous.map(row => measures(row)[i]),
  }));
}
