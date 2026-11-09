import { publicResearchUrl, type CustomerResearch, type ResearchIdentity } from "./customer-research.ts";
import { parseEmailSummary, type EmailSummary } from "./email-summary.ts";

export type SummaryResearch = Omit<CustomerResearch, "status"> & {
  status: NonNullable<EmailSummary["research"]>["status"];
};

/** Send public identity only, never the conversation or private CRM notes. */
export async function loadSummaryResearch({ allowed, identity, research }: {
  allowed: boolean;
  identity: ResearchIdentity;
  research: (identity: ResearchIdentity) => Promise<CustomerResearch>;
}): Promise<SummaryResearch> {
  const empty = { checkedAt: new Date().toISOString(), findings: "", sources: [], queries: [] };
  if (!allowed) return { ...empty, status: "disabled" };
  const name = identity.name?.trim();
  if (!publicResearchUrl(identity.website) && (!name || /^(unknown company|no linked company|unknown|customer)$/i.test(name))) {
    return { ...empty, status: "no_identity" };
  }
  try {
    const result = await research(identity);
    return { ...result, sources: result.sources.filter(source => publicResearchUrl(source.url)) };
  } catch {
    // Research failures must not prevent summarizing the conversation.
    return { ...empty, status: "unavailable" };
  }
}

/** Source links and research status come from the server, never model output. */
export function attachSummaryResearch(output: string, research: SummaryResearch): string {
  const summary = parseEmailSummary(output);
  const sources = research.status === "complete" ? research.sources : [];
  const ids = new Set(sources.map(source => source.id));
  const verifiedIds = (values: string[]) => [...new Set(values.filter(id => ids.has(id)))];
  const companyFindings = (summary.companyFindings ?? []).flatMap(finding => {
    const sourceIds = verifiedIds(finding.sourceIds);
    return sourceIds.length ? [{ ...finding, sourceIds }] : [];
  });
  const selected = new Set(summary.productSkus ?? []);
  const productRecommendations = (summary.productRecommendations ?? []).flatMap(recommendation => {
    const sourceIds = verifiedIds(recommendation.sourceIds);
    if (!selected.has(recommendation.sku) || (recommendation.basis === "opportunity" && !sourceIds.length)) return [];
    return [{ ...recommendation, sourceIds }];
  });
  // A rejected inferred recommendation cannot survive as a context-free product card.
  const rejected = new Set((summary.productRecommendations ?? [])
    .filter(item => item.basis === "opportunity" && !productRecommendations.some(valid => valid.sku === item.sku))
    .map(item => item.sku));
  return JSON.stringify({ ...summary, companyFindings, productRecommendations,
    productSkus: summary.productSkus?.filter(sku => !rejected.has(sku)),
    products: summary.products?.filter(product => !rejected.has(product.sku)),
    productMatchStatus: summary.productMatchStatus === "matched" && !summary.products?.some(product => !rejected.has(product.sku)) ? "no_match" : summary.productMatchStatus,
    research: { status: research.status, checkedAt: research.checkedAt, sources: sources.map(({ id, label, url }) => ({ id, label, url })) },
  });
}
