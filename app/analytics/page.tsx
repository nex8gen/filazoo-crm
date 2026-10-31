import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { getAnalyticsDashboardData } from "@/lib/data/analytics";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Analytics" };

export default async function DashboardPage() {
  return <AnalyticsDashboard data={await getAnalyticsDashboardData()} />;
}
