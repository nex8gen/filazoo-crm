"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { HomeOverview } from "@/components/home-overview";
import { HomeTeamPerformance } from "@/components/home-team-performance";
import { HomeAiComposer } from "@/components/home-ai-composer";
import type { HomeData, HomeRange } from "@/lib/home";
import "./home-workspace.css";

export function HomeWorkspace({ data }: { data: HomeData }) {
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();
  const changeRange = (range: HomeRange) => {
    const query = new URLSearchParams({ from: range.from, to: range.to });
    startRefresh(() => router.push(`/?${query}`, { scroll: false }));
  };

  return <div className="home-workspace mx-auto flex w-full max-w-[1440px] flex-col gap-6">
    <h1 className="sr-only">Home</h1>
    <HomeOverview data={data} refreshing={refreshing} onRangeChange={changeRange} onRefresh={() => startRefresh(() => router.refresh())} />

    {data.unavailable.length ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs"><p>Some data could not be loaded: {data.unavailable.join(", ")}. Affected totals are unavailable.</p><button type="button" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} className="font-medium underline">Try again</button></div> : null}

    {data.isAdmin ? <HomeTeamPerformance data={data} refreshing={refreshing} /> : null}

    <HomeAiComposer />
  </div>;
}
