import { requireWorkspaceMember } from "@/lib/auth";
import { EmailCampaignsWorkspace } from "@/components/email-campaigns-workspace";
import { marketingYearSchema } from "@/lib/marketing-assets";
import { listProducts } from "@/lib/data/crm";

export const metadata = { title: "Marketing campaigns" };

export default async function EmailCampaignsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = await searchParams;
  const parsedYear = marketingYearSchema.safeParse(params.year);
  const year = parsedYear.success ? parsedYear.data : Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Shanghai" }).format(new Date()));
  const { products } = await listProducts();
  return <EmailCampaignsWorkspace key={`${viewer.workspaceId}-${viewer.id}-${year}`} sessionScope={`${viewer.workspaceId}:${viewer.id}`} products={products} initialYear={year} canWrite={viewer.role !== "viewer"} />;
}
