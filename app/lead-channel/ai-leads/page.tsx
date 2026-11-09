import { requireWorkspaceMember } from "@/lib/auth";
import { leadProductOptions, listLeadSearches } from "@/lib/data/ai-leads";
import { AiLeadsWorkspace } from "@/components/ai-leads-workspace";
import { Country } from "country-state-city";

export const metadata = { title:"AI Leads" };
export default async function AiLeadsPage() {
  const viewer = await requireWorkspaceMember();
  const [products,searches] = await Promise.allSettled([leadProductOptions(viewer),listLeadSearches(viewer)]);
  const error = searches.status === "rejected" ? "AI lead searches could not be loaded. Refresh to retry or check the database setup." : products.status === "rejected" ? "Your product catalog could not be loaded. You can describe a product below or refresh to retry." : "";
  return <AiLeadsWorkspace key={viewer.workspaceId} workspaceName={viewer.workspaceName} countries={Country.getAllCountries().map(country=>country.name).sort()} products={products.status==="fulfilled" ? products.value : []} initialSearches={searches.status==="fulfilled" ? searches.value : []} canWrite={viewer.role!=="viewer"} initialError={error} />;
}
