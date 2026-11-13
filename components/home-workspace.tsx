"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


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

    {data.unavailable.length ? <NotificationToast tone="warning"><p>Some data could not be loaded: {data.unavailable.join(", ")}. Affected totals are unavailable.</p><button type="button" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} className="font-medium underline">Try again</button></NotificationToast> : null}

    <HomeAiComposer name={data.name} asOf={data.asOf} />

    {data.isAdmin ? <HomeTeamPerformance data={data} refreshing={refreshing} /> : null}
  </div>;
}
