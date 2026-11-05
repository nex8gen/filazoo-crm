import { getWorkspaceViewer } from "@/lib/auth";
import { UserMenuClient } from "@/components/user-menu-client";
import { profileAvatarUrl } from "@/lib/profile-avatar";

export async function UserMenu() {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return null;
  const name = viewer.displayName || viewer.email?.split("@")[0] || "Account";
  return <UserMenuClient userId={viewer.id} name={name} email={viewer.email || ""} role={viewer.role} workspaceName={viewer.workspaceName} imageUrl={profileAvatarUrl(viewer.id, viewer.avatarPath)} preset={viewer.avatarPreset} />;
}
