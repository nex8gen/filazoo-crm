import { getWorkspaceViewer } from "@/lib/auth";
import { UserMenuClient } from "@/components/user-menu-client";
import { profileAvatarUrl } from "@/lib/profile-avatar";
import { workspaceSubscription } from "@/lib/billing/data";
import { findPlan, legacyPlans } from "@/lib/billing/plans";

export async function UserMenu() {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return null;
  // Billing availability must not prevent opening the account menu or signing out.
  const subscription = await workspaceSubscription(viewer.workspaceId).catch(() => null);
  const plan = subscription?.catalogVersion === 1
    ? legacyPlans.find(plan => plan.id === subscription.activePlan)
    : findPlan(subscription?.activePlan);
  const planName = subscription?.grandfathered ? "Beta" : plan?.name;
  const name = viewer.displayName || viewer.email?.split("@")[0] || "Account";
  return <UserMenuClient userId={viewer.id} name={name} email={viewer.email || ""} role={viewer.role} workspaceName={viewer.workspaceName} planName={planName} imageUrl={profileAvatarUrl(viewer.id, viewer.avatarPath)} preset={viewer.avatarPreset} />;
}
