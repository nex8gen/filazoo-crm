import { DeliverabilityDashboard } from "@/components/emails-dashboard";
import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailConnectionsOverview } from "@/lib/data/app-connections";

export const metadata = { title: "Email connection checks" };

export default async function DeliverabilityPage() {
  const viewer = await requireWorkspaceMember();
  return <DeliverabilityDashboard overview={await getEmailConnectionsOverview()} canManageTeam={viewer.role === "admin"} />;
}
