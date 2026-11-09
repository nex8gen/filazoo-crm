import { z } from "zod";
import { publicResearchUrl } from "./ai/customer-research.ts";
import { buyerRoles, buyerRoleLabels, leadAudienceSchema, qualificationFromChecks, type LeadCheck, type QualificationStatus } from "./lead-prospecting.ts";

const text = (max: number) => z.string().trim().max(max);
export const leadSearchSchema = z.object({
  requestId: z.uuid(),
  productSkus: z.array(text(100).min(1)).max(5).default([]),
  customProduct: z.object({ name: text(160).min(2), description: text(1500).min(10) }).optional(),
  productContext: text(1000).optional(),
  profileId: z.uuid().optional(),
  segmentIds: z.array(text(60).min(2)).max(5).optional(),
  categoryOverride: text(160).optional(),
  definitionOverride: text(1000).optional(),
  audience: leadAudienceSchema.optional(),
  searchName: text(160).optional(),
  country: text(100).min(2), city: text(100).default(""),
  buyerTypes: text(500).default(""), requirements: text(1500).default(""), exclusions: text(1000).default(""),
  limit: z.union([z.literal(3), z.literal(5), z.literal(10)]).default(5),
}).strict().refine(value => value.productSkus.length > 0 || value.customProduct, { message: "Select a product or describe one." });
export type LeadSearchInput = z.infer<typeof leadSearchSchema>;
export const leadProfileRequestSchema = z.object({
  productSkus: z.array(text(100).min(1)).max(5).default([]),
  customProduct: z.object({ name: text(160).min(2), description: text(1500).min(10) }).optional(),
  productContext: text(1000).default(""),
}).strict().refine(value=>value.productSkus.length>0||value.customProduct,{message:"Choose a product or describe what you sell."});
export type LeadProduct = { sku: string; name: string; description: string; moq: number | null; catalogContext?: string[]; businessContext?: string };
export type LeadFeedback = { domain: string; reason: string };
export const feedbackReasons = ["good_match", "wrong_industry", "wrong_location", "competitor", "contact_incorrect", "dismissed"] as const;
export const leadMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), searchId: z.uuid() }).strict(),
  z.object({ action: z.literal("save"), searchId: z.uuid(), leadId: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal("feedback"), searchId: z.uuid(), leadId: z.string().min(1).max(100), reason: z.enum(feedbackReasons) }).strict(),
]);
export type LeadProof = { value: string; quote: string; sourceUrl: string };
export type BusinessPage = { url: string; text: string; emails: string[]; phones: string[]; links: string[] };
export type LeadCandidate = { name: string; website: string; sourceUrl?: string };
export type LeadResult = {
  id: string; name: string; website: string; domain: string; country: string; city: string;
  segment: string; summary: string; fitScore: number; confidence: "supported" | "needs_review";
  fitEvidence: LeadProof | null; locationEvidence: LeadProof | null;
  identityEvidence?: LeadProof | null;
  buyerEvidence?: LeadProof | null;
  requirementEvidence?: LeadProof | null;
  buyingIntent: LeadProof | null; address: LeadProof | null; contactName: LeadProof | null; contactRole: LeadProof | null;
  emails: Array<{ value: string; sourceUrl: string; status: "unverified" }>;
  phones: Array<{ value: string; sourceUrl: string }>;
  sources: string[]; matchedProducts: string[]; checkedAt: string;
  qualification?: QualificationStatus; checks?: LeadCheck[]; buyerRole?: typeof buyerRoles[number]; buyerGroup?: string;
  reviewReason?: string; contactPage?: string; researchVersion?: 2;
  existingCompanyId?: string; savedCompanyId?: string; feedback?: typeof feedbackReasons[number];
};
export type LeadSearch = {
  id: string; status: "queued" | "running" | "complete" | "failed" | "cancelled";
  phase: string; criteria: LeadSearchInput; products: LeadProduct[]; results: LeadResult[];
  error: string | null; createdAt: string; updatedAt: string;
  researchSummary?: import("./lead-discovery-policy.ts").LeadResearchSummary | null;
};
export const normalizedEvidence = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export function leadDomain(value: string) {
  const url = publicResearchUrl(value);
  return url ? new URL(url).hostname.replace(/^www\./, "").replace(/\.$/, "").toLowerCase() : null;
}
export function supportedProof(value: unknown, pages: BusinessPage[], requireValue = false, minimumQuoteLength = 8): LeadProof | null {
  if (!value || typeof value !== "object") return null;
  const proof = value as LeadProof;
  if (typeof proof.value !== "string" || !proof.value.trim() || proof.value.length > 1000 || typeof proof.quote !== "string" || proof.quote.trim().length < minimumQuoteLength || proof.quote.length > 600 || typeof proof.sourceUrl !== "string") return null;
  const page = pages.find(page => page.url === proof.sourceUrl);
  const quote = normalizedEvidence(proof.quote);
  if (!page || !normalizedEvidence(page.text).includes(quote) || (requireValue && !quote.includes(normalizedEvidence(proof.value)))) return null;
  if(minimumQuoteLength<8&&quote.length<8){
    const content=normalizedEvidence(page.text);
    let index=content.indexOf(quote),bounded=false;
    while(index>=0){if((index===0||!/\p{L}|\p{N}/u.test(content[index-1]))&&(index+quote.length===content.length||!/\p{L}|\p{N}/u.test(content[index+quote.length]))){bounded=true;break;}index=content.indexOf(quote,index+1);}
    if(!bounded)return null;
  }
  return { value: proof.value.trim(), quote: proof.quote.trim(), sourceUrl: page.url };
}

/** A real quote about a different country/city is still not location proof. */
export function locationProofMatchesTarget(proof: LeadProof | null, input: Pick<LeadSearchInput, "country" | "city">) {
  if (!proof) return false;
  const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const quote = " " + normalize(proof.quote) + " ";
  const aliases: Record<string, string[]> = {
    usa: ["united states", "united states of america", "usa"], us: ["united states", "united states of america", "usa"],
    "united states": ["united states", "united states of america", "usa"],
    uk: ["united kingdom", "uk", "great britain"], "united kingdom": ["united kingdom", "uk", "great britain"],
    uae: ["united arab emirates", "uae"], "united arab emirates": ["united arab emirates", "uae"],
  };
  const country = normalize(input.country);
  const countryMatches = (aliases[country] ?? [country]).some(value => quote.includes(" " + value + " ")) ||
    ["us", "usa", "united states"].includes(country) && /\bU\.?S\.?(?:A\.?)?\b/.test(proof.quote);
  return countryMatches && (!input.city || quote.includes(" " + normalize(input.city) + " "));
}

/** Contact values come from downloaded pages, never model-generated fields. */
export function buildLeadResult(candidate: LeadCandidate, assessment: Record<string, unknown>, pages: BusinessPage[], products: LeadProduct[], input: LeadSearchInput, checkedAt: string): LeadResult {
  const domain = leadDomain(candidate.website)!;
  const officialPages = pages.filter(page => leadDomain(page.url) === domain);
  const matched = products.filter(product => Array.isArray(assessment.matchedProducts) && assessment.matchedProducts.includes(product.sku));
  // A generic company description cannot prove fit when the assessment could
  // not connect the company to even one of the actual selected products.
  const fitEvidence = matched.length ? supportedProof(assessment.fitEvidence, officialPages) : null;
  const locationEvidence = supportedProof(assessment.locationEvidence, officialPages);
  const locationMatches = assessment.locationMatches === true && Boolean(locationEvidence);
  const buyerMatches = assessment.buyerMatches === true && Boolean(fitEvidence);
  const requirementsMet = assessment.requirementsMet === true;
  const excluded = assessment.excluded === true;
  const emails = [...new Map(officialPages.flatMap(page => page.emails.map(value => [value, { value, sourceUrl: page.url, status: "unverified" as const }] as const))).values()].slice(0, 5);
  const phones = [...new Map(officialPages.flatMap(page => page.phones.map(value => [value, { value, sourceUrl: page.url }] as const))).values()].slice(0, 3);
  const confirmed = Boolean(fitEvidence && locationMatches && buyerMatches && requirementsMet && !excluded);
  // A mismatch never becomes a high fit merely because contact details exist.
  const fitScore = excluded ? 0 : Math.min(confirmed ? 100 : 49, (fitEvidence ? 40 : 0) + (locationMatches ? 30 : 0) + (buyerMatches ? 20 : 0) + (requirementsMet ? 10 : 0));
  const safe = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const base: LeadResult = {
    id: domain, name: candidate.name, website: candidate.website, domain, country: locationMatches ? input.country : "", city: locationMatches ? input.city : "",
    segment: safe(assessment.segment, 120), summary: safe(assessment.summary, 1800), fitScore, confidence: confirmed ? "supported" : "needs_review",
    fitEvidence, locationEvidence, buyingIntent: supportedProof(assessment.buyingIntent, officialPages), address: supportedProof(assessment.address, officialPages, true),
    contactName: supportedProof(assessment.contactName, officialPages, true), contactRole: supportedProof(assessment.contactRole, officialPages, true),
    emails, phones, sources: officialPages.map(page => page.url), checkedAt,
    matchedProducts: fitEvidence ? matched.map(product => product.name) : [],
  };
  if (!input.audience) return base;
  const states = ["met", "unknown", "not_met"];
  const status = (value: unknown) => states.includes(String(value)) ? value as "met" | "unknown" | "not_met" : "unknown";
  const productState = status(assessment.productStatus);
  const locationState = status(assessment.locationStatus);
  const buyerState = status(assessment.buyerStatus);
  const requirementState = input.requirements ? status(assessment.requirementStatus) : "met";
  const selectedSegment = input.audience.segments.find(segment=>segment.id===assessment.segmentId);
  const identityEvidence = supportedProof(assessment.identityEvidence,officialPages,true,2);
  const buyerEvidence = supportedProof(assessment.buyerEvidence,officialPages);
  const requirementEvidence = input.requirements ? supportedProof(assessment.requirementEvidence, officialPages) : null;
  const observedRole = buyerRoles.includes(assessment.observedRole as typeof buyerRoles[number]) ? assessment.observedRole as typeof buyerRoles[number] : "unknown";
  const roleMismatch = observedRole!=="unknown"&&Boolean(selectedSegment)&&observedRole!==selectedSegment?.role;
  const buyerVerified = buyerState==="met"&&Boolean(selectedSegment&&fitEvidence&&buyerEvidence)&&observedRole!=="unknown";
  const checks: LeadCheck[] = [
    {key:"product",label:"Product relevance",state:productState==="met"&&(!fitEvidence||!["direct","application"].includes(String(assessment.fitStrength))) ? "unknown" : productState,reason:safe(assessment.productReason,400)||"Product relevance has not been established."},
    {key:"location",label:"Target location",state:locationState==="met"&&!locationProofMatchesTarget(locationEvidence,input) ? "unknown" : locationState,reason:safe(assessment.locationReason,400)||"Physical presence in the target market is unconfirmed."},
    {key:"buyer",label:"Buyer group",state:excluded||roleMismatch ? "not_met" : buyerState==="met"&&!buyerVerified ? "unknown" : buyerState,reason:excluded ? "Matches an excluded business type." : roleMismatch ? "Observed role: "+buyerRoleLabels[observedRole]+". This is not the selected buyer group's activity." : safe(assessment.buyerReason,400)||"No selected buyer group was established."},
    {key:"requirements",label:"Requirements",state:requirementState==="met"&&input.requirements&&!requirementEvidence ? "unknown" : requirementState,reason:input.requirements ? safe(assessment.requirementReason,400)||"Additional requirements need checking." : "No additional requirements."},
    {key:"identity",label:"Company identity",state:status(assessment.identityStatus)==="met"&&!identityEvidence ? "unknown" : status(assessment.identityStatus),reason:safe(assessment.identityReason,400)||"Company identity has not been confirmed on its official website."},
  ];
  const qualification = qualificationFromChecks(checks);
  const score = (checks[0].state==="met" ? assessment.fitStrength==="direct" ? 45 : 25 : 0)+(checks[1].state==="met" ? 20 : 0)+(checks[2].state==="met" ? 15 : 0)+(input.requirements&&checks[3].state==="met" ? 10 : 0)+(base.buyingIntent ? 10 : 0);
  const locationConfirmed = checks[1].state==="met";
  return {...base,qualification,checks,identityEvidence,buyerEvidence,requirementEvidence,name:identityEvidence?.value||base.name,researchVersion:2,buyerGroup:roleMismatch ? buyerRoleLabels[observedRole] : selectedSegment?.label||"Unclassified",buyerRole:observedRole,
    confidence:qualification==="qualified" ? "supported" : "needs_review",fitScore:qualification==="rejected" ? 0 : Math.min(qualification==="qualified" ? 100 : 59,score),
    country:locationConfirmed ? input.country : "",city:locationConfirmed ? input.city : "",
    reviewReason:checks.find(check=>check.state==="not_met")?.reason||checks.find(check=>check.state==="unknown")?.reason||"Matches the selected product, market and buyer group.",
    contactPage:officialPages.find(page=>/contact|kontakt|impressum|contatt/i.test(new URL(page.url).pathname))?.url,
  };
}
