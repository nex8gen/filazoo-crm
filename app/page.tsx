import type { Metadata } from "next";
import { HomeWorkspace } from "@/components/home-workspace";
import { getHomeData } from "@/lib/data/home";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ from?: string | string[]; to?: string | string[] }> }) {
  const query = await searchParams;
  const range = { from: typeof query.from === "string" ? query.from : undefined, to: typeof query.to === "string" ? query.to : undefined };
  return <HomeWorkspace data={await getHomeData(range)} />;
}
