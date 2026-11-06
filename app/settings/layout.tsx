import { Suspense, type ReactNode } from "react";
import { requireWorkspaceMember } from "@/lib/auth";
import { SettingsNavigation } from "./settings-navigation";
import { SettingsSkeleton, SettingsNavigationSkeleton } from "@/components/settings-skeleton";
import "./settings.css";

async function Navigation() {
  const viewer = await requireWorkspaceMember();
  return <SettingsNavigation isAdmin={viewer.role === "admin"} workspaceName={viewer.workspaceName} />;
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <div className="settings-workspace">
    <div className="settings-navigation-frame">
      <Suspense fallback={<SettingsNavigationSkeleton />}><Navigation /></Suspense>
    </div>
    <div className="settings-main">
      <Suspense fallback={<SettingsSkeleton />}>{children}</Suspense>
    </div>
  </div>;
}
