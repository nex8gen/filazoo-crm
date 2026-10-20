import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { getAnalyticsDashboardData } from "@/lib/data/analytics";

export default async function DashboardPage() {
  return <AnalyticsDashboard data={await getAnalyticsDashboardData()} />;
}
