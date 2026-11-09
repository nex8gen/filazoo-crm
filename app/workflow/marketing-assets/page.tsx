import { MarketingAssetsWorkspace } from "@/components/marketing-assets-workspace";
import { requireWorkspaceMember } from "@/lib/auth";
import { listMarketingAssets } from "@/lib/data/marketing-assets";
import { listProducts } from "@/lib/data/crm";
import { marketingYearSchema, type MarketingAsset } from "@/lib/marketing-assets";

export const metadata = { title: "Marketing Assets" };

export default async function MarketingAssetsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = await searchParams;
  const parsedYear = marketingYearSchema.safeParse(params.year);
  const year = parsedYear.success ? parsedYear.data : Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Shanghai" }).format(new Date()));
  const [assetResult, productResult] = await Promise.allSettled([listMarketingAssets(viewer, year), listProducts()]);
  const assets: MarketingAsset[] = assetResult.status === "fulfilled" ? assetResult.value : [];
  const products = productResult.status === "fulfilled" ? productResult.value.products.filter(product => product.status === "Active").map(({ sku, name, material }) => ({ sku, name, material })) : [];
  const loadError = assetResult.status === "rejected" ? "Your saved promotions could not be loaded. Try again before creating or editing a plan." : productResult.status === "rejected" ? "The product catalog could not be loaded. Try again before editing a plan." : undefined;
  return <MarketingAssetsWorkspace key={year} year={year} initialAssets={assets} products={products} canWrite={viewer.role !== "viewer"} loadError={loadError} />;
}
