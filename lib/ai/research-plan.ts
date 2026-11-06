import type { ResearchIdentity } from "./customer-research.ts";

export const publicCompanyResearchInstruction = [
  "Produce new public customer intelligence for FILAZOO sales decisions, not a recap of the supplied CRM identity.",
  "First use Google Search to establish whether a business matches the exact supplied company name or publicly indexed contact email. Search the name with location and the quoted email when available. Cross-check the official domain, location and business contact. An email domain is an identity clue, not proof; a personal mailbox is never an employer. Do not search generic phrases such as 'about this customer'.",
  "Then visit the supplied website with URL Context even if Google finds no matching company. Read the homepage and relevant about, shop/catalog, brands, services, locations or wholesale pages found in search results. Prefer pages on the supplied domain. Never invent page URLs or claim a page was read without a successful retrieval receipt.",
  "Extract what the customer actually sells or makes: product categories, filament materials and diameters, printer or filament brands, services, target buyers, sales channels, and whether it is a retailer, distributor, print service or manufacturer. Prioritize details that change our sales approach.",
  "Find dated evidence of business size: employees, branches, warehouses, geographic coverage, printer fleet or production capacity, and published revenue. If hard figures are unavailable, describe observable scale signals such as catalog breadth or distribution reach and label any size assessment as an inference. A website, product count or social following alone does not prove revenue, purchasing volume or a printer fleet.",
  "Identify two to four relevant filament opportunities only when supported by the customer's verified activities. For each, connect the observed activity or assortment gap to a material/application, state confidence, and say what compatibility or commercial detail needs confirmation. For resellers focus on assortment, brands, diameters and channels; for print services focus on applications and printer compatibility. Do not recommend every material by default. A technology vendor hosting a printing website is not evidence that the vendor buys filament.",
  "Keep different companies separate. Omit unrelated namesakes and generic CRM articles; mention an ambiguous candidate only when its identity evidence materially affects the match. If the exact company cannot be verified, say so without claiming it does not exist.",
  "Return a concise sourced brief: identity match, important new business/product findings, size evidence or its limits, and evidence-based sales opportunities with a few focused questions. Omit CRM email history, quotes, payments, stored buying volumes and repeated contact details. Do not invent facts, quantities, prices, availability or purchasing needs. Cite actual source URLs and distinguish observed facts, inferences and unknowns.",
].join("\n");

export function researchQueries(identity: ResearchIdentity) {
  const clean = (value?: string) => value?.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim() ?? "";
  const name = clean(identity.name), location = [clean(identity.city), clean(identity.country)].filter(Boolean).join(" ");
  let host: string | undefined;
  try { if (identity.website) host = new URL(identity.website).hostname; } catch { /* The caller normalizes public websites. */ }
  return [...new Set([
    name && `"${name}" ${location} official website`,
    identity.email && `"${clean(identity.email)}" company`,
    host && `site:${host} about products brands locations`,
    name && `"${name}" employees locations company size`,
  ].filter((query): query is string => Boolean(query)).map(query => query.replace(/\s+/g, " ").trim().slice(0, 200)))].slice(0, 4);
}

/** Only public research topics, never raw private correspondence or deal details. */
export function researchTopics(questions: string[]) {
  const request = questions.slice(-3).join(" ");
  return ["exact business identity and email/domain match", "official website, about and catalog pages", "products, materials, brands, services and sales channels", "dated company size evidence and observable scale signals", "evidence-based filament sales opportunities",
    ...(/owner|director|founder/i.test(request) ? ["publicly listed founders and directors"] : []),
    ...(/contact|phone|email/i.test(request) ? ["published business contact channels"] : [])];
}
