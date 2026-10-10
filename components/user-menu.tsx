import { getWorkspaceViewer } from "@/lib/auth";
import { UserMenuClient } from "@/components/user-menu-client";

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

export async function UserMenu() {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return null;
  const name = viewer.displayName || viewer.email?.split("@")[0] || "Account";
  return <UserMenuClient name={name} email={viewer.email || ""} role={viewer.role} initials={initials(name)} />;
}
