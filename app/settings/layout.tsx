import { Suspense, type ReactNode } from "react";
import { requireWorkspaceMember } from "@/lib/auth";
import { SettingsNavigation } from "./settings-navigation";
import { SettingsSkeleton, SettingsNavigationSkeleton } from "@/components/settings-skeleton";
import "./settings.css";

async function Navigation() {
  const viewer = await requireWorkspaceMember();
  return <SettingsNavigation isAdmin={viewer.role === "admin"} />;
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <div className="settings-workspace flex min-h-[calc(100dvh-3rem)] flex-col md:flex-row">
    <Suspense fallback={<SettingsNavigationSkeleton />}><Navigation /></Suspense>
    <div className="min-w-0 flex-1 p-5 sm:p-8 lg:p-10">
      <Suspense fallback={<SettingsSkeleton />}>{children}</Suspense>
    </div>
  </div>;
}
