import { redirect } from "next/navigation";
import { marketingYearSchema } from "@/lib/marketing-assets";

export default async function MarketingAssetsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const params = await searchParams;
  const parsedYear = marketingYearSchema.safeParse(params.year);
  redirect(`/email/campaigns${parsedYear.success ? `?year=${parsedYear.data}` : ""}`);
}
