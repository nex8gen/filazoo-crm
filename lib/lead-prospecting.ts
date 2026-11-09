import { z } from "zod";

export const buyerRoles = ["end_user", "service_provider", "distributor", "reseller", "manufacturer", "unknown"] as const;
export const buyerSegmentSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{2,60}$/),
  label: z.string().trim().min(2).max(100),
  role: z.enum(buyerRoles),
  reason: z.string().trim().min(5).max(400),
  searchTerms: z.array(z.string().trim().min(2).max(150)).min(1).max(3),
}).strict();
export const buyerProfileSchema = z.object({
  category: z.string().trim().min(2).max(160),
  definition: z.string().trim().min(10).max(1000),
  clarity: z.enum(["clear", "needs_clarification"]),
  clarification: z.string().trim().max(500),
  segments: z.array(buyerSegmentSchema).min(1).max(5),
  excludeHints: z.array(z.string().trim().max(150)).max(5),
  contactRoles: z.array(z.string().trim().max(80)).max(5),
}).strict();
export type BuyerProfile = z.infer<typeof buyerProfileSchema> & { id: string };
export const leadAudienceSchema = z.object({
  category: z.string().trim().min(2).max(160),
  definition: z.string().trim().min(10).max(1000),
  segments: z.array(buyerSegmentSchema).min(1).max(5),
  contactRoles: z.array(z.string().trim().max(80)).max(5),
}).strict();
export type LeadAudience = z.infer<typeof leadAudienceSchema>;
export type QualificationStatus = "qualified" | "review" | "rejected";
export type CheckState = "met" | "unknown" | "not_met";
export type LeadCheck = { key: "product" | "location" | "buyer" | "requirements" | "identity"; label: string; state: CheckState; reason: string };
export const qualificationLabels: Record<QualificationStatus, string> = { qualified: "Qualified", review: "Needs review", rejected: "Not a fit" };
export const buyerRoleLabels: Record<typeof buyerRoles[number], string> = {
  end_user: "Product user", service_provider: "Service provider", distributor: "Distributor", reseller: "Reseller", manufacturer: "Manufacturer", unknown: "Unclassified",
};

export function qualificationFromChecks(checks: LeadCheck[]): QualificationStatus {
  if (!checks.length) return "review";
  if (checks.some(check => check.state === "not_met")) return "rejected";
  return checks.every(check => check.state === "met") ? "qualified" : "review";
}

export function legacyQualification(result: { qualification?: QualificationStatus; matchedProducts: string[]; fitEvidence: unknown; confidence: string; fitScore: number }): QualificationStatus {
  if (result.qualification) return result.qualification;
  if (!result.matchedProducts.length || !result.fitEvidence) return "review";
  return result.confidence === "supported" && result.fitScore >= 70 ? "qualified" : "review";
}
