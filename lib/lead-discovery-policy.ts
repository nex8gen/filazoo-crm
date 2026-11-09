import { leadDomain, type LeadCandidate, type LeadResult, type LeadSearchInput } from "./ai-leads.ts";

export type LeadCompanyIdentity = { name: string; domain?: string | null; website?: string | null };
export type LeadResearchSummary = {
  version: 3; queries: string[]; candidates: number; duplicates: number; researched: number;
  unreadable: number; rejected: number; needsReview: number; noContact: number; qualified: number;
};

// Exact normalized business names catch alternate domains. Short brands use
// domain matching so an abbreviation does not suppress unrelated businesses.
export function leadCompanyName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/(?:\s+(?:incorporated|inc|llc|ltd|limited|corporation|corp|gmbh|sarl|plc|pty|co|company))+$/u, "").trim();
}
export function leadCompanyExclusions(companies: LeadCompanyIdentity[] = []) {
  const domains = new Set<string>(), names = new Set<string>();
  for (const company of companies) {
    for (const value of [company.domain, company.website]) {
      const domain = value && leadDomain(value);
      if (domain) domains.add(domain.replace(/\.$/, ""));
    }
    const name = leadCompanyName(company.name);
    if (name.length >= 4) names.add(name);
  }
  return {
    domains: [...domains],
    has(company: LeadCompanyIdentity) {
      const host = leadDomain(company.domain || company.website || "")?.replace(/\.$/, "");
      // A site's www/contact subdomain belongs to the same company. Do not
      // guess registrable domains: unrelated tenants can share a host suffix.
      if (host) for (const domain of domains) if (host === domain || host.endsWith("." + domain) || domain.endsWith("." + host)) return true;
      const name = leadCompanyName(company.name);
      return name.length >= 4 && names.has(name);
    },
  };
}

/** Rotate actual buyer activities, without silently broadening the location. */
export function leadSearchPlan(input: LeadSearchInput, attempt = 0, excludedDomains: string[] = []) {
  const terms = [...new Set(input.audience?.segments.flatMap(segment => segment.searchTerms) ?? [input.buyerTypes || input.customProduct?.name || "businesses"])];
  const location = [input.city, input.country].filter(Boolean).join(" ");
  const start = Math.max(0, attempt) % terms.length;
  const angle = ["official website contact", "services capabilities", "applications company locations"][Math.floor(Math.max(0, attempt) / terms.length) % 3];
  const exclusions = excludedDomains.slice(0, 8).map(domain => "-site:" + domain).join(" ");
  return Array.from({ length: Math.min(3, terms.length) }, (_, offset) =>
    [terms[(start + offset) % terms.length], location, angle, exclusions].filter(Boolean).join(" "),
  );
}

export function isQualifiedLead(lead: LeadResult) {
  const keys = ["product", "location", "buyer", "requirements", "identity"];
  return lead.researchVersion === 2 && lead.qualification === "qualified" && lead.confidence === "supported" &&
    lead.matchedProducts.length > 0 && Boolean(lead.fitEvidence && lead.locationEvidence && lead.identityEvidence && lead.buyerEvidence) &&
    keys.every(key => lead.checks?.some(check => check.key === key && check.state === "met"));
}
export const hasLeadContact = (lead: LeadResult) => Boolean(lead.emails.length || lead.phones.length || lead.contactPage);
export const candidateIdentity = (candidate: LeadCandidate): LeadCompanyIdentity => ({ name: candidate.name, website: candidate.website });
