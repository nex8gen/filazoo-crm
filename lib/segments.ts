import { z } from "zod";
import { pipelineStageLabels, pipelineStageValues, type Company } from "./types.ts";

export const segmentRulesSchema = z.object({
  businessSegment: z.string().trim().min(1).max(120).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  source: z.string().trim().min(1).max(120).optional(),
  stage: z.enum(pipelineStageValues).optional(),
  minFitScore: z.number().int().min(1).max(10).optional(),
  hasEmail: z.boolean().optional(),
  companyIds: z.array(z.uuid()).min(1, "Choose at least one company.").max(5000).optional(),
}).strict().refine((rules) => rules.companyIds === undefined || Object.entries(rules).every(([key, value]) => key === "companyIds" || value === undefined), { message: "Choose either individual companies or audience rules." });

export const segmentInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a segment name of at least 2 characters.").max(120),
  description: z.string().trim().max(500),
  rules: segmentRulesSchema,
});

export type SegmentRules = z.infer<typeof segmentRulesSchema>;
export type SavedSegment = { id: string; name: string; description: string; rules: SegmentRules; createdAt: string };
export type SegmentCompany = Pick<Company, "id" | "name" | "segment" | "country" | "source" | "sourceLabel" | "stage" | "fitScore"> & { hasEmail: boolean };

export function matchesSegment(company: SegmentCompany, rules: SegmentRules): boolean {
  if (rules.companyIds !== undefined) return rules.companyIds.includes(company.id);
  return (!rules.businessSegment || company.segment === rules.businessSegment)
    && (!rules.country || company.country === rules.country)
    && (!rules.source || company.source === rules.source)
    && (!rules.stage || company.stage === pipelineStageLabels[rules.stage])
    && (rules.minFitScore === undefined || company.fitScore >= rules.minFitScore)
    && (rules.hasEmail === undefined || company.hasEmail === rules.hasEmail);
}

export function toSegmentCompany(company: Company): SegmentCompany {
  const { id, name, segment, country, source, sourceLabel, stage, fitScore, email } = company;
  return { id, name, segment, country, source, sourceLabel, stage, fitScore, hasEmail: Boolean(email.trim()) };
}

export function segmentRuleLabels(rules: SegmentRules, sources: Record<string, string> = {}): string[] {
  if (rules.companyIds !== undefined) return ["Individually selected companies"];
  return [
    rules.businessSegment,
    rules.country,
    rules.source ? sources[rules.source] || rules.source.replaceAll("_", " ") : undefined,
    rules.stage ? pipelineStageLabels[rules.stage] : undefined,
    rules.minFitScore === undefined ? undefined : `Fit score ≥ ${rules.minFitScore}`,
    rules.hasEmail === undefined ? undefined : rules.hasEmail ? "Has contact email" : "Missing contact email",
  ].filter((value): value is string => Boolean(value));
}

export function summarizeSegment(companies: SegmentCompany[]) {
  const rated = companies.filter((company) => company.fitScore > 0);
  const won = companies.filter((company) => company.stage === pipelineStageLabels.won).length;
  const lost = companies.filter((company) => company.stage === pipelineStageLabels.lost).length;
  return {
    count: companies.length,
    withEmail: companies.filter((company) => company.hasEmail).length,
    countries: new Set(companies.map((company) => company.country).filter((country) => country !== "Unknown")).size,
    averageFit: rated.length ? rated.reduce((sum, company) => sum + company.fitScore, 0) / rated.length : null,
    won,
    active: companies.length - won - lost,
    stages: pipelineStageValues.map((stage) => ({ stage, label: pipelineStageLabels[stage], count: companies.filter((company) => company.stage === pipelineStageLabels[stage]).length })),
  };
}
