import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { requireWorkspaceMember } from "@/lib/auth";

export default async function DashboardPage() {
  await requireWorkspaceMember(["admin", "operator", "viewer"]);
  return <AnalyticsDashboard />;
}
